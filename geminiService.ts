import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import { simpleGit } from "simple-git";
import cors from "cors";
import fs, { promises as fsPromises } from "fs";
import { Octokit } from "@octokit/rest";
import "dotenv/config";

// --- TYPES ---
interface AgentResult {
  agentName: string;
  status: "success" | "error";
  data: any;
  logs: string[];
}

interface ProjectContext {
  uploadPath: string;
  repoName: string;
  githubUsername: string;
  pat: string;
  visibility: "public" | "private";
  readme?: string;
  gitignore?: string;
  license?: string;
  commitMessage?: string;
  cicdWorkflow?: string;
  repoUrl?: string;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  
  // Global request logger
  app.use((req, res, next) => {
    console.log(`[GLOBAL] ${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Ensure temp_uploads exists
  const baseUploadPath = path.join(process.cwd(), "temp_uploads");
  if (!fs.existsSync(baseUploadPath)) {
    fs.mkdirSync(baseUploadPath, { recursive: true });
  }

  // --- API ROUTER ---
  const apiRouter = express.Router();
  
  // Debug middleware for API
  apiRouter.use((req, res, next) => {
    console.log(`[API] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
  });

  // Health check endpoint
  apiRouter.get("/health", (req, res) => {
    res.json({ status: "ok", message: "DevOps Server is active" });
  });

  apiRouter.get("/test", (req, res) => {
    res.json({ message: "API is working" });
  });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        const deployId = req.body.deployId || "default";
        const uploadPath = path.join(process.cwd(), "temp_uploads", deployId);
        
        // Use a property on req to cache the directory creation check
        if (!(req as any)._dirCreated) {
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          (req as any)._dirCreated = true;
        }
        
        const relativePath = file.originalname;
        // Handle potential path traversal or absolute paths in originalname
        const safePath = relativePath.replace(/^(\.\.\/|\/)+/, "");
        const dir = path.dirname(path.join(uploadPath, safePath));
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        cb(null, dir);
      } catch (error: any) {
        cb(error, "");
      }
    },
    filename: (req, file, cb) => {
      cb(null, path.basename(file.originalname));
    },
  });

  const upload = multer({ 
    storage,
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB per file
      files: 5000 // Max 5000 files
    }
  });

  const GitHubDeploymentAgent = async (ctx: ProjectContext): Promise<AgentResult> => {
    const logs = ["Creating GitHub repository...", "Initializing Git and pushing code..."];
    try {
      // Write AI generated files
      if (ctx.readme) await fsPromises.writeFile(path.join(ctx.uploadPath, "README.md"), ctx.readme);
      if (ctx.gitignore) await fsPromises.writeFile(path.join(ctx.uploadPath, ".gitignore"), ctx.gitignore);
      if (ctx.license) await fsPromises.writeFile(path.join(ctx.uploadPath, "LICENSE"), ctx.license);
      if (ctx.cicdWorkflow) {
        const workflowDir = path.join(ctx.uploadPath, ".github", "workflows");
        await fsPromises.mkdir(workflowDir, { recursive: true });
        await fsPromises.writeFile(path.join(workflowDir, "main.yml"), ctx.cicdWorkflow);
      }

      const octokit = new Octokit({ auth: ctx.pat });
      let repoUrl = "";
      try {
        logs.push("Verifying GitHub credentials...");
        const { data: user } = await octokit.users.getAuthenticated();
        logs.push(`Authenticated as: ${user.login}`);
        
        const { data } = await octokit.repos.createForAuthenticatedUser({
          name: ctx.repoName,
          private: ctx.visibility === "private",
          auto_init: false,
        });
        repoUrl = data.clone_url;
        logs.push(`Repository created: ${data.html_url}`);
      } catch (error: any) {
        if (error.status === 401) {
          throw new Error("Invalid GitHub Personal Access Token (Bad credentials). Please check your token and ensure it hasn't expired.");
        }
        if (error.status === 422) {
          logs.push("Repository already exists. Using existing repository.");
          repoUrl = `https://github.com/${ctx.githubUsername}/${ctx.repoName}.git`;
        } else throw error;
      }

      const git = simpleGit(ctx.uploadPath);
      await git.init();
      
      // Set local git identity to prevent "Author identity unknown" errors
      await git.addConfig("user.name", ctx.githubUsername);
      await git.addConfig("user.email", `${ctx.githubUsername}@users.noreply.github.com`);

      await git.add(".");
      await git.commit(ctx.commitMessage || "Initial commit by Multi-Agent AI DevOps System");

      const authenticatedUrl = repoUrl.replace("https://", `https://${ctx.pat}@`);
      const remotes = await git.getRemotes();
      if (remotes.find(r => r.name === "origin")) await git.removeRemote("origin");
      await git.addRemote("origin", authenticatedUrl);

      try {
        await git.push("origin", "main", ["--force"]);
        logs.push("Successfully pushed to 'main' branch.");
      } catch (e) {
        await git.push("origin", "master", ["--force"]);
        logs.push("Successfully pushed to 'master' branch.");
      }

      ctx.repoUrl = repoUrl.replace(/https:\/\/.*@/, "https://");
      return { agentName: "GitHub Deployment Agent", status: "success", data: { repoUrl: ctx.repoUrl }, logs };
    } catch (e: any) {
      return { agentName: "GitHub Deployment Agent", status: "error", data: e.message, logs: [...logs, `Error: ${e.message}`] };
    }
  };

  // --- MAIN PIPELINE ENDPOINT ---

  apiRouter.post("/deploy", (req, res, next) => {
    console.log(`[API] Received deploy request: ${req.method} ${req.originalUrl}`);
    next();
  }, upload.array("files"), async (req, res) => {
    const { 
      repoName, 
      githubUsername, 
      pat, 
      visibility, 
      deployId,
      readme,
      gitignore,
      license,
      cicdWorkflow,
      commitMessage
    } = req.body;
    
    if (!deployId) {
      return res.status(400).json({ success: false, error: "Missing deployId" });
    }

    const uploadPath = path.join(process.cwd(), "temp_uploads", deployId);

    const ctx: ProjectContext = {
      uploadPath,
      repoName,
      githubUsername,
      pat,
      visibility,
      readme,
      gitignore,
      license,
      cicdWorkflow,
      commitMessage
    };

    try {
      const deployRes = await GitHubDeploymentAgent(ctx);
      
      if (deployRes.status === "error") {
        return res.status(500).json({ 
          success: false, 
          error: deployRes.data, 
          results: [deployRes] 
        });
      }

      res.json({ 
        success: true, 
        results: [deployRes],
        repoUrl: ctx.repoUrl
      });
    } catch (error: any) {
      console.error("Pipeline error:", error);
      res.status(500).json({ 
        success: false, 
        error: error.message
      });
    } finally {
      try { await fsPromises.rm(uploadPath, { recursive: true, force: true }); } catch (e) {}
    }
  });

  apiRouter.post("/issues", async (req, res) => {
    const { githubUsername, repoName, pat, issues } = req.body;
    const logs = ["Posting issues to GitHub..."];
    
    try {
      const octokit = new Octokit({ auth: pat });
      for (const issue of issues) {
        await octokit.issues.create({
          owner: githubUsername,
          repo: repoName,
          title: issue.title,
          body: issue.body,
          labels: issue.labels
        });
      }
      res.json({ success: true, logs });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 404 handler for API routes
  apiRouter.use((req, res) => {
    console.warn(`[API 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({
      success: false,
      error: `API route not found: ${req.method} ${req.originalUrl}`
    });
  });

  // Error handler for API routes
  apiRouter.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("API Error:", err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || "An internal server error occurred"
    });
  });

  // Mount API router BEFORE Vite/Static
  app.use("/api", apiRouter);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      console.log(`[SPA Fallback] Serving index.html for: ${req.method} ${req.url}`);
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Multi-Agent DevOps Server running on http://localhost:${PORT}`);
  });

  // Increase server timeout for large deployments (10 minutes)
  server.timeout = 600000;
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
