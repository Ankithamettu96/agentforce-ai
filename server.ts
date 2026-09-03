import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import { simpleGit } from "simple-git";
import cors from "cors";
import fs, { promises as fsPromises } from "fs";
import { Octokit } from "@octokit/rest";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

// ============================================================
// TYPES
// ============================================================

interface AgentFile {
  path: string;
  content: string;
}

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

// ============================================================
// SERVER
// ============================================================

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // ----------------------------------------------------------
  // MIDDLEWARE
  // ----------------------------------------------------------

  app.use(cors());

  app.use((req, res, next) => {
    console.log(
      `[GLOBAL] ${new Date().toISOString()} - ${req.method} ${req.url}`
    );
    next();
  });

  // Allow larger JSON payloads because source code is sent
  // to the AI agent.
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  // ----------------------------------------------------------
  // TEMP UPLOAD DIRECTORY
  // ----------------------------------------------------------

  const baseUploadPath = path.join(
    process.cwd(),
    "temp_uploads"
  );

  if (!fs.existsSync(baseUploadPath)) {
    fs.mkdirSync(baseUploadPath, { recursive: true });
  }

  // ----------------------------------------------------------
  // API ROUTER
  // ----------------------------------------------------------

  const apiRouter = express.Router();

  app.use("/api", apiRouter);

  apiRouter.use((req, res, next) => {
    console.log(
      `[API] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
    );
    next();
  });

  // ==========================================================
  // HEALTH
  // ==========================================================

  apiRouter.get("/health", (req, res) => {
    res.json({
      status: "ok",
      message: "DevOps Server is active",
    });
  });

  // ==========================================================
  // TEST
  // ==========================================================

  apiRouter.get("/test", (req, res) => {
    res.json({
      message: "API is working",
    });
  });

  // ==========================================================
  // AI AGENT ENDPOINT
  // ==========================================================

  apiRouter.post("/agent", async (req, res) => {
    try {
      const {
        agentName,
        fileList,
        files,
      }: {
        agentName?: string;
        fileList?: string;
        files?: AgentFile[];
      } = req.body;

      // ------------------------------------------------------
      // Validate agent name
      // ------------------------------------------------------

      if (!agentName) {
        return res.status(400).json({
          success: false,
          error: "Missing agentName",
        });
      }

      // ------------------------------------------------------
      // Validate Gemini API key
      // ------------------------------------------------------

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          success: false,
          error:
            "GEMINI_API_KEY is not configured on the server.",
        });
      }

      // ------------------------------------------------------
      // Validate files
      // ------------------------------------------------------

      const projectFiles = Array.isArray(files)
        ? files
        : [];

      // Keep AI request reasonably sized.
      const MAX_TOTAL_CONTENT = 600_000;

      let totalCharacters = 0;

      const safeFiles: AgentFile[] = [];

      for (const file of projectFiles) {
        if (
          !file ||
          typeof file.path !== "string" ||
          typeof file.content !== "string"
        ) {
          continue;
        }

        if (totalCharacters >= MAX_TOTAL_CONTENT) {
          break;
        }

        const remaining =
          MAX_TOTAL_CONTENT - totalCharacters;

        const content = file.content.slice(
          0,
          remaining
        );

        safeFiles.push({
          path: file.path,
          content,
        });

        totalCharacters += content.length;
      }

      // ------------------------------------------------------
      // Build source-code context
      // ------------------------------------------------------

      const sourceContext =
        safeFiles.length > 0
          ? safeFiles
              .map(
                (file) =>
                  `\n===== FILE: ${file.path} =====\n${file.content}`
              )
              .join("\n")
          : "No source-code contents were provided.";

      // ------------------------------------------------------
      // Agent-specific instructions
      // ------------------------------------------------------

      const agentInstructions: Record<
        string,
        string
      > = {
        "Project Analyzer": `
Analyze the project architecture.

Identify:
- Project type
- Programming languages
- Frameworks
- Libraries
- Important files
- Frontend/backend structure
- How the application appears to work
- Entry points
- APIs
- Database usage if visible
- Major dependencies
`,

        "Code Quality Agent": `
Review the provided source code for code-quality issues.

Look for:
- Bad practices
- Duplicated logic
- Poor naming
- Error handling problems
- Maintainability problems
- TypeScript/JavaScript issues
- Unnecessary complexity
- Potential bugs

Give practical recommendations.
`,

        "Security Agent": `
Perform a defensive security review.

Look for:
- Hardcoded secrets
- API-key exposure
- Unsafe authentication
- GitHub token handling
- Command execution risks
- Path traversal
- Unsafe file uploads
- Injection risks
- CORS concerns
- Sensitive information exposure

Do not expose or reproduce any secrets you encounter.
Give remediation recommendations.
`,

        "Git Agent": `
Analyze the project's Git configuration.

Check:
- .gitignore
- Repository structure
- Files that should not be committed
- Git configuration
- Commit structure
- Repository readiness

Suggest improvements.
`,

        "DevOps Agent": `
Analyze the DevOps and deployment configuration.

Check:
- CI/CD
- Docker configuration
- Build process
- Environment variables
- Production configuration
- Deployment readiness
- Frontend/backend deployment architecture

Give practical deployment recommendations.
`,

        "Deployment Agent": `
Analyze whether the project is ready for deployment.

Check:
- Build configuration
- Start scripts
- Environment variables
- Backend/frontend configuration
- Production risks
- Deployment blockers

Return a deployment-readiness assessment.
`,
      };

      const instructions =
        agentInstructions[agentName] ||
        `
Analyze the project as a general software engineering agent.
Identify important architecture, quality, security and deployment concerns.
`;

      // ------------------------------------------------------
      // Gemini
      // ------------------------------------------------------

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
      });

      const prompt = `
You are the "${agentName}" in an AI-powered DevOps
platform called AgentForge AI.

Your job is to analyze the ACTUAL PROJECT SOURCE CODE
provided below.

IMPORTANT RULES:
1. Base your analysis only on the provided project information.
2. Do not claim to have inspected files that were not provided.
3. Do not invent technologies or functionality.
4. If something cannot be determined, explicitly say so.
5. Never reproduce passwords, API keys, tokens or other secrets.
6. Give practical developer-focused recommendations.

============================================================
PROJECT FILE LIST
============================================================

${fileList || "No file list provided."}

============================================================
SOURCE CODE
============================================================

${sourceContext}

============================================================
AGENT TASK
============================================================

${instructions}

============================================================
OUTPUT FORMAT
============================================================

Provide:

1. Summary
2. Findings
3. Important files
4. Problems/Risks
5. Recommendations
6. Overall assessment

Keep the response useful and reasonably concise.
`;

      console.log(
        `[AI] Running ${agentName} with ${safeFiles.length} source files`
      );

      const response =
        await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        });

      const text =
        response.text ||
        "Gemini returned no text.";

      console.log(
        `[AI] ${agentName} completed successfully`
      );

      return res.json({
        success: true,
        agentName,
        data: {
          analysis: text,
          filesAnalyzed: safeFiles.length,
        },
        logs: [
          `${agentName} connected to Gemini successfully.`,
          `Analyzed ${safeFiles.length} project files.`,
          "AI analysis generated successfully.",
        ],
      });
    } catch (error: any) {
      console.error(
        "Gemini agent error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          "Gemini request failed.",
      });
    }
  });

  // ==========================================================
  // MULTER STORAGE
  // ==========================================================

  const storage =
    multer.diskStorage({
      destination: (req, file, cb) => {
        try {
          const deployId =
            req.body.deployId ||
            `deploy-${Date.now()}`;

          const uploadPath = path.join(
            process.cwd(),
            "temp_uploads",
            deployId
          );

          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, {
              recursive: true,
            });
          }

          // Normalize path separators.
          const relativePath =
            file.originalname.replace(
              /\\/g,
              "/"
            );

          // Remove dangerous leading path components.
          const safePath =
            relativePath.replace(
              /^(\.\.\/|\/)+/,
              ""
            );

          const dir = path.dirname(
            path.join(
              uploadPath,
              safePath
            )
          );

          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {
              recursive: true,
            });
          }

          cb(null, dir);
        } catch (error: any) {
          cb(error, "");
        }
      },

      filename: (req, file, cb) => {
        cb(
          null,
          path.basename(file.originalname)
        );
      },
    });

  const upload = multer({
    storage,

    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 5000,
    },
  });

  // ==========================================================
  // GITHUB DEPLOYMENT AGENT
  // ==========================================================

  const GitHubDeploymentAgent = async (
    ctx: ProjectContext
  ): Promise<AgentResult> => {
    const logs = [
      "Creating GitHub repository...",
      "Initializing Git and preparing code...",
    ];

    try {
      // ------------------------------------------------------
      // Write AI-generated files
      // ------------------------------------------------------

      if (ctx.readme) {
        await fsPromises.writeFile(
          path.join(
            ctx.uploadPath,
            "README.md"
          ),
          ctx.readme
        );
      }

      if (ctx.gitignore) {
        await fsPromises.writeFile(
          path.join(
            ctx.uploadPath,
            ".gitignore"
          ),
          ctx.gitignore
        );
      }

      if (ctx.license) {
        await fsPromises.writeFile(
          path.join(
            ctx.uploadPath,
            "LICENSE"
          ),
          ctx.license
        );
      }

      if (ctx.cicdWorkflow) {
        const workflowDir =
          path.join(
            ctx.uploadPath,
            ".github",
            "workflows"
          );

        await fsPromises.mkdir(
          workflowDir,
          {
            recursive: true,
          }
        );

        await fsPromises.writeFile(
          path.join(
            workflowDir,
            "main.yml"
          ),
          ctx.cicdWorkflow
        );
      }

      // ------------------------------------------------------
      // GitHub API
      // ------------------------------------------------------

      const octokit = new Octokit({
        auth: ctx.pat,
      });

      let repoUrl = "";

      try {
        logs.push(
          "Verifying GitHub credentials..."
        );

        const { data: user } =
          await octokit.users.getAuthenticated();

        logs.push(
          `Authenticated as: ${user.login}`
        );

        const { data } =
          await octokit.repos.createForAuthenticatedUser(
            {
              name: ctx.repoName,
              private:
                ctx.visibility === "private",
              auto_init: false,
            }
          );

        repoUrl = data.clone_url;

        logs.push(
          `Repository created: ${data.html_url}`
        );
      } catch (error: any) {
        if (error.status === 401) {
          throw new Error(
            "Invalid GitHub Personal Access Token. Please check your token."
          );
        }

        if (error.status === 422) {
          logs.push(
            "Repository already exists. Using existing repository."
          );

          repoUrl =
            `https://github.com/${ctx.githubUsername}/${ctx.repoName}.git`;
        } else {
          throw error;
        }
      }

      // ------------------------------------------------------
      // Git
      // ------------------------------------------------------

      const git = simpleGit(
        ctx.uploadPath
      );

      await git.init();

      await git.addConfig(
        "user.name",
        ctx.githubUsername
      );

      await git.addConfig(
        "user.email",
        `${ctx.githubUsername}@users.noreply.github.com`
      );

      await git.add(".");

      // Check whether there are files to commit.
      const status =
        await git.status();

      if (
        status.files.length > 0
      ) {
        await git.commit(
          ctx.commitMessage ||
            "Initial commit by AgentForge AI"
        );
      } else {
        logs.push(
          "No new files to commit."
        );
      }

      // ------------------------------------------------------
      // Push
      // ------------------------------------------------------

      /*
       * The token is used only for the authenticated
       * remote operation. It is not returned to the client.
       */
      const authenticatedUrl =
        repoUrl.replace(
          "https://",
          `https://${encodeURIComponent(
            ctx.pat
          )}@`
        );

      const remotes =
        await git.getRemotes();

      if (
        remotes.find(
          (remote) =>
            remote.name === "origin"
        )
      ) {
        await git.removeRemote(
          "origin"
        );
      }

      await git.addRemote(
        "origin",
        authenticatedUrl
      );

      try {
        await git.push(
          "origin",
          "main",
          ["--force"]
        );

        logs.push(
          "Successfully pushed to 'main' branch."
        );
      } catch (mainError) {
        logs.push(
          "Main branch push failed. Trying master..."
        );

        await git.push(
          "origin",
          "master",
          ["--force"]
        );

        logs.push(
          "Successfully pushed to 'master' branch."
        );
      }

      // Remove origin so the temporary token-bearing
      // remote is not left in the local repository.
      try {
        await git.removeRemote(
          "origin"
        );
      } catch {
        // Ignore cleanup error.
      }

      ctx.repoUrl =
        repoUrl.replace(
          /\.git$/,
          ""
        );

      return {
        agentName:
          "GitHub Deployment Agent",

        status: "success",

        data: {
          repoUrl: ctx.repoUrl,
        },

        logs,
      };
    } catch (error: any) {
      console.error(
        "GitHub deployment error:",
        error
      );

      return {
        agentName:
          "GitHub Deployment Agent",

        status: "error",

        data:
          error?.message ||
          "GitHub deployment failed.",

        logs: [
          ...logs,
          `Error: ${
            error?.message ||
            "Unknown deployment error"
          }`,
        ],
      };
    }
  };

  // ==========================================================
  // DEPLOYMENT ENDPOINT
  // ==========================================================

  apiRouter.post(
    "/deploy",
    (req, res, next) => {
      console.log(
        `[API] Received deploy request: ${req.method} ${req.originalUrl}`
      );

      next();
    },

    (req, res, next) => {
      upload.array("files")(
        req,
        res,
        (err) => {
          if (err) {
            console.error(
              "Upload error:",
              err
            );

            return res.status(400).json({
              success: false,
              error: `Upload failed: ${err.message}`,
            });
          }

          next();
        }
      );
    },

    async (req, res) => {
      const {
        repoName,
        githubUsername,

        // Accept both names so the frontend
        // can send githubToken.
        pat,
        githubToken,

        visibility,

        deployId,

        readme,
        gitignore,
        license,
        cicdWorkflow,
        commitMessage,
      } = req.body;

      // ------------------------------------------------------
      // GitHub token
      // ------------------------------------------------------

      const githubPat =
        pat || githubToken;

      if (!githubPat) {
        return res.status(400).json({
          success: false,
          error:
            "Missing GitHub Personal Access Token.",
        });
      }

      // ------------------------------------------------------
      // Repository information
      // ------------------------------------------------------

      if (!repoName) {
        return res.status(400).json({
          success: false,
          error:
            "Missing repository name.",
        });
      }

      if (!githubUsername) {
        return res.status(400).json({
          success: false,
          error:
            "Missing GitHub username.",
        });
      }

      // ------------------------------------------------------
      // Generate deploy ID if frontend did not provide one.
      // ------------------------------------------------------

      const finalDeployId =
        deployId ||
        `deploy-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

      const uploadPath =
        path.join(
          process.cwd(),
          "temp_uploads",
          finalDeployId
        );

      // ------------------------------------------------------
      // Context
      // ------------------------------------------------------

      const ctx: ProjectContext = {
        uploadPath,

        repoName,

        githubUsername,

        pat: githubPat,

        visibility:
          visibility === "private"
            ? "private"
            : "public",

        readme,

        gitignore,

        license,

        cicdWorkflow,

        commitMessage,
      };

      try {
        // Make sure upload directory exists.
        if (
          !fs.existsSync(
            uploadPath
          )
        ) {
          await fsPromises.mkdir(
            uploadPath,
            {
              recursive: true,
            }
          );
        }

        const deployRes =
          await GitHubDeploymentAgent(
            ctx
          );

        if (
          deployRes.status ===
          "error"
        ) {
          return res.status(500).json({
            success: false,
            error: deployRes.data,
            results: [
              deployRes,
            ],
          });
        }

        return res.json({
          success: true,

          message:
            "Project deployed successfully to GitHub.",

          results: [
            deployRes,
          ],

          repoUrl:
            ctx.repoUrl,
        });
      } catch (error: any) {
        console.error(
          "Pipeline error:",
          error
        );

        return res.status(500).json({
          success: false,
          error:
            error?.message ||
            "Deployment failed.",
        });
      } finally {
        // ----------------------------------------------------
        // Clean temporary uploaded project.
        // ----------------------------------------------------

        try {
          await fsPromises.rm(
            uploadPath,
            {
              recursive: true,
              force: true,
            }
          );
        } catch (cleanupError) {
          console.error(
            "Temporary upload cleanup failed:",
            cleanupError
          );
        }
      }
    }
  );

  // ==========================================================
  // GITHUB ISSUES
  // ==========================================================

  apiRouter.post(
    "/issues",
    async (req, res) => {
      const {
        githubUsername,
        repoName,
        pat,
        githubToken,
        issues,
        results,
      } = req.body;

      const githubPat =
        pat || githubToken;

      try {
        if (!githubUsername) {
          return res.status(400).json({
            success: false,
            error:
              "Missing GitHub username.",
          });
        }

        if (!repoName) {
          return res.status(400).json({
            success: false,
            error:
              "Missing repository name.",
          });
        }

        if (!githubPat) {
          return res.status(400).json({
            success: false,
            error:
              "Missing GitHub token.",
          });
        }

        const octokit =
          new Octokit({
            auth: githubPat,
          });

        // Support both `issues` and the
        // result format currently used by App.tsx.
        const issueList =
          Array.isArray(issues)
            ? issues
            : [];

        // If actual issues were provided,
        // create them.
        for (const issue of issueList) {
          if (!issue?.title) {
            continue;
          }

          await octokit.issues.create({
            owner: githubUsername,
            repo: repoName,
            title: issue.title,
            body:
              issue.body ||
              "Created by AgentForge AI.",
            labels:
              issue.labels || [],
          });
        }

        return res.json({
          success: true,
          logs: [
            "GitHub issue processing completed.",
            `Issues created: ${issueList.length}`,
          ],
        });
      } catch (error: any) {
        console.error(
          "Issue creation error:",
          error
        );

        return res.status(500).json({
          success: false,
          error:
            error?.message ||
            "Failed to create GitHub issues.",
        });
      }
    }
  );

  // ==========================================================
  // 404 API HANDLER
  // ==========================================================

  apiRouter.use(
    (req, res) => {
      res.status(404).json({
        success: false,
        error:
          `API route not found: ${req.method} ${req.originalUrl}`,
      });
    }
  );

  // ==========================================================
  // API ERROR HANDLER
  // ==========================================================

  apiRouter.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      console.error(
        "API Error:",
        err
      );

      res.status(
        err.status || 500
      ).json({
        success: false,
        error:
          err.message ||
          "An internal server error occurred.",
      });
    }
  );

  // ==========================================================
  // VITE / PRODUCTION FRONTEND
  // ==========================================================

  if (
    process.env.NODE_ENV !==
    "production"
  ) {
    const vite =
      await createViteServer({
        server: {
          middlewareMode: true,
        },

        appType: "spa",
      });

    app.use(
      vite.middlewares
    );
  } else {
    const distPath =
      path.join(
        process.cwd(),
        "dist"
      );

    app.use(
      express.static(distPath)
    );

    app.get(
      "*",
      (req, res) => {
        console.log(
          `[SPA Fallback] Serving index.html for: ${req.method} ${req.url}`
        );

        res.sendFile(
          path.join(
            distPath,
            "index.html"
          )
        );
      }
    );
  }

  // ==========================================================
  // START SERVER
  // ==========================================================

  app.listen(
    PORT,
    "0.0.0.0",
    () => {
      console.log(
        `Multi-Agent DevOps Server running on http://localhost:${PORT}`
      );
    }
  );
}

// ============================================================
// START
// ============================================================

startServer().catch(
  (error) => {
    console.error(
      "Failed to start server:",
      error
    );

    process.exit(1);
  }
);