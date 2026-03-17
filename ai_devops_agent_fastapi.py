import os
import shutil
import json
import base64
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from git import Repo, GitCommandError
import google.generativeai as genai
from github import Github, GithubException

app = FastAPI(title="AI GitHub DevOps Agent")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Gemini
# genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
# model = genai.GenerativeModel('gemini-1.5-flash')

class AIDevOpsAgent:
    def __init__(self, github_token: str, gemini_api_key: str):
        self.github_token = github_token
        self.gh = Github(github_token)
        genai.configure(api_key=gemini_api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')

    async def analyze_and_generate(self, folder_path: str):
        """Analyzes codebase and generates README, .gitignore, and commit message."""
        files = []
        for root, _, filenames in os.walk(folder_path):
            for f in filenames:
                files.append(os.path.relpath(os.path.join(root, f), folder_path))
        
        file_list_str = "\n".join(files[:100]) # Limit for prompt
        
        prompt = f"""
        Analyze this project structure:
        {file_list_str}
        
        Tasks:
        1. Detect tech stack.
        2. Generate a professional README.md.
        3. Generate a .gitignore.
        4. Generate a smart initial commit message.
        5. Provide a health check summary.
        
        Return JSON:
        {{
            "readme": "...",
            "gitignore": "...",
            "commit_message": "...",
            "analysis": "...",
            "health_check": "..."
        }}
        """
        
        response = self.model.generate_content(prompt)
        # Clean JSON response
        text = response.text.replace("```json", "").replace("```", "").strip()
        return json.loads(text)

    def create_repo(self, repo_name: str, private: bool = False):
        """Creates a new GitHub repository."""
        user = self.gh.get_user()
        try:
            repo = user.create_repo(repo_name, private=private)
            return repo
        except GithubException as e:
            if e.status == 422: # Already exists
                return user.get_repo(repo_name)
            raise e

    def deploy(self, folder_path: str, repo_url: str, commit_msg: str):
        """Git init, commit, and push."""
        try:
            if os.path.exists(os.path.join(folder_path, ".git")):
                repo = Repo(folder_path)
            else:
                repo = Repo.init(folder_path)
            
            repo.git.add(A=True)
            repo.index.commit(commit_msg)
            
            # Auth URL
            auth_url = repo_url.replace("https://", f"https://{self.github_token}@")
            
            if 'origin' in repo.remotes:
                origin = repo.remote('origin')
                origin.set_url(auth_url)
            else:
                origin = repo.create_remote('origin', auth_url)
            
            origin.push(refspec='HEAD:main', force=True)
            return True
        except Exception as e:
            print(f"Git Error: {e}")
            return False

@app.post("/deploy")
async def deploy_project(
    repo_name: str = Form(...),
    github_token: str = Form(...),
    gemini_key: str = Form(...),
    private: bool = Form(False),
    files: List[UploadFile] = File(...)
):
    deploy_id = os.urandom(4).hex()
    temp_dir = f"temp_{deploy_id}"
    os.makedirs(temp_dir, exist_ok=True)

    try:
        # 1. Save uploaded files
        for file in files:
            file_path = os.path.join(temp_dir, file.filename)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

        agent = AIDevOpsAgent(github_token, gemini_key)

        # 2. AI Analysis
        ai_data = await agent.analyze_and_generate(temp_dir)

        # 3. Write AI files
        with open(os.path.join(temp_dir, "README.md"), "w") as f:
            f.write(ai_data['readme'])
        with open(os.path.join(temp_dir, ".gitignore"), "w") as f:
            f.write(ai_data['gitignore'])

        # 4. Create Repo
        repo = agent.create_repo(repo_name, private)

        # 5. Deploy
        success = agent.deploy(temp_dir, repo.clone_url, ai_data['commit_message'])

        if not success:
            raise HTTPException(status_code=500, detail="Git push failed")

        return {
            "status": "success",
            "repo_url": repo.html_url,
            "analysis": ai_data['analysis'],
            "health_check": ai_data['health_check']
        }

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
