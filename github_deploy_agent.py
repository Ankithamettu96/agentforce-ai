import os
import sys
import shutil
from git import Repo, GitCommandError
import argparse

class GitHubDeployAgent:
    def __init__(self, repo_url, pat, commit_message="Initial commit"):
        self.repo_url = repo_url
        self.pat = pat
        self.commit_message = commit_message
        self.auth_url = self._get_auth_url()

    def _get_auth_url(self):
        """Embeds the PAT into the GitHub URL for authentication."""
        if self.repo_url.startswith("https://"):
            return self.repo_url.replace("https://", f"https://{self.pat}@")
        return self.repo_url

    def deploy(self, folder_path):
        """Main deployment logic."""
        if not os.path.exists(folder_path):
            print(f"Error: Folder '{folder_path}' not found.")
            return False

        try:
            # 1. Initialize Git repository if not already initialized
            if not os.path.exists(os.path.join(folder_path, ".git")):
                print(f"Initializing Git repository in {folder_path}...")
                repo = Repo.init(folder_path)
            else:
                print(f"Existing Git repository found in {folder_path}.")
                repo = Repo(folder_path)

            # 2. Add all files
            print("Adding files to Git...")
            repo.git.add(A=True)

            # 3. Create a commit
            try:
                print(f"Creating commit: '{self.commit_message}'...")
                repo.index.commit(self.commit_message)
            except Exception as e:
                # If there's nothing to commit, GitPython might raise an error
                if "nothing to commit" in str(e).lower():
                    print("Nothing to commit, working tree clean.")
                else:
                    raise e

            # 4. Connect to remote origin
            print(f"Connecting to remote: {self.repo_url}...")
            try:
                origin = repo.remote(name='origin')
                origin.set_url(self.auth_url)
            except ValueError:
                origin = repo.create_remote('origin', self.auth_url)

            # 5. Push to GitHub
            print("Pushing to GitHub...")
            # Try main first, then master
            try:
                origin.push(refspec='HEAD:main', force=True)
                print("Successfully pushed to 'main' branch.")
            except GitCommandError:
                print("Push to 'main' failed, trying 'master'...")
                origin.push(refspec='HEAD:master', force=True)
                print("Successfully pushed to 'master' branch.")

            print("\nDeployment Complete! 🚀")
            return True

        except GitCommandError as e:
            print(f"\nGit Error: {e}")
            return False
        except Exception as e:
            print(f"\nAn unexpected error occurred: {e}")
            return False

def main():
    parser = argparse.ArgumentParser(description="GitHub Deployment Agent")
    parser.add_argument("--folder", required=True, help="Path to the local folder to deploy")
    parser.add_argument("--repo", required=True, help="GitHub repository URL (HTTPS)")
    parser.add_argument("--token", required=True, help="GitHub Personal Access Token (PAT)")
    parser.add_argument("--message", default="Initial commit by Agent", help="Commit message")

    args = parser.parse_args()

    agent = GitHubDeployAgent(args.repo, args.token, args.message)
    agent.deploy(args.folder)

if __name__ == "__main__":
    main()

# --- HOW TO RUN LOCALLY ---
# 1. Install GitPython: pip install GitPython
# 2. Run the script:
#    python github_deploy_agent.py --folder ./my-project --repo https://github.com/user/repo.git --token your_pat_here


