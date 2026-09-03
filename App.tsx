import React, { useState } from "react";
import {
  Upload,
  Bot,
  CheckCircle2,
  XCircle,
  Loader2,
  FolderOpen,
  Rocket,
  ShieldCheck,
  Code2,
  FileCode2,
  GitBranch,
  Server,
  Sparkles,
  AlertTriangle,
} from "lucide-react";

interface AIFile {
  path: string;
  content: string;
}

interface ProjectContext {
  fileList: string;
  filesForAI: AIFile[];
  readme?: string;
  gitignore?: string;
  license?: string;
  cicdWorkflow?: string;
  commitMessage?: string;
}

interface AgentResult {
  agentName: string;
  status: "success" | "error";
  data: any;
  logs: string[];
}

interface PipelineAgent {
  name: string;
  description: string;
  icon: React.ReactNode;
}

const agents: PipelineAgent[] = [
  {
    name: "Project Analyzer",
    description: "Analyzes project structure, technologies and source code",
    icon: <Code2 size={20} />,
  },
  {
    name: "Code Quality Agent",
    description: "Reviews source code and identifies quality issues",
    icon: <FileCode2 size={20} />,
  },
  {
    name: "Security Agent",
    description: "Checks the project for potential security problems",
    icon: <ShieldCheck size={20} />,
  },
  {
    name: "Git Agent",
    description: "Prepares Git configuration and repository structure",
    icon: <GitBranch size={20} />,
  },
  {
    name: "DevOps Agent",
    description: "Analyzes deployment and CI/CD configuration",
    icon: <Server size={20} />,
  },
  {
    name: "Deployment Agent",
    description: "Deploys the project to GitHub",
    icon: <Rocket size={20} />,
  },
];

const App: React.FC = () => {
  const [githubUsername, setGithubUsername] = useState("");
  const [repoName, setRepoName] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentAgent, setCurrentAgent] = useState("");
  const [results, setResults] = useState<Record<string, AgentResult>>({});
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  /*
   * Files/folders that should never be sent to the AI.
   */
  const shouldExcludeFile = (file: File): boolean => {
    const path =
      (file as any).webkitRelativePath || file.name;

    const normalizedPath = path.replace(/\\/g, "/");
    const pathParts = normalizedPath.split("/");

    const blockedFileNames = new Set([
      ".env",
      ".env.local",
      ".env.production",
      ".env.development",
      ".env.test",
      "credentials.json",
      "service-account.json",
      "secrets.json",
    ]);

    const blockedFolders = new Set([
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      ".nuxt",
      "coverage",
      "venv",
      ".venv",
      "__pycache__",
      ".idea",
      ".vscode",
    ]);

    const blockedExtensions = [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".webp",
      ".ico",
      ".mp4",
      ".mp3",
      ".wav",
      ".avi",
      ".mov",
      ".zip",
      ".rar",
      ".7z",
      ".pdf",
      ".exe",
      ".dll",
      ".so",
      ".dylib",
      ".woff",
      ".woff2",
      ".ttf",
      ".otf",
      ".pem",
      ".key",
      ".p12",
      ".pfx",
    ];

    if (blockedFileNames.has(file.name.toLowerCase())) {
      return true;
    }

    if (
      pathParts.some((part: string) =>
        blockedFolders.has(part)
      )
    ) {
      return true;
    }

    if (
      blockedExtensions.some((extension) =>
        file.name.toLowerCase().endsWith(extension)
      )
    ) {
      return true;
    }

    return false;
  };

  /*
   * Read source files for AI analysis.
   */
  const readFilesForAI = async (
    files: File[]
  ): Promise<AIFile[]> => {
    const MAX_FILE_SIZE = 100_000;
    const MAX_TOTAL_SIZE = 800_000;

    let totalSize = 0;

    const supportedExtensions = [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".json",
      ".css",
      ".scss",
      ".html",
      ".md",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".hpp",
      ".cs",
      ".go",
      ".rs",
      ".php",
      ".rb",
      ".swift",
      ".kt",
      ".kts",
      ".xml",
      ".yml",
      ".yaml",
      ".toml",
      ".properties",
      ".sql",
      ".sh",
      ".bat",
      ".ps1",
      ".txt",
      ".gitignore",
      ".dockerfile",
    ];

    const filesForAI: AIFile[] = [];

    for (const file of files) {
      if (shouldExcludeFile(file)) {
        continue;
      }

      const path =
        (file as any).webkitRelativePath || file.name;

      const lowerName = file.name.toLowerCase();

      const hasSupportedExtension =
        supportedExtensions.some((extension) =>
          lowerName.endsWith(extension)
        ) ||
        lowerName === "dockerfile" ||
        lowerName === ".gitignore";

      if (!hasSupportedExtension) {
        continue;
      }

      if (file.size > MAX_FILE_SIZE) {
        filesForAI.push({
          path,
          content: "[File skipped because it is too large]",
        });

        continue;
      }

      if (totalSize + file.size > MAX_TOTAL_SIZE) {
        filesForAI.push({
          path,
          content:
            "[File skipped because the AI input size limit was reached]",
        });

        continue;
      }

      try {
        const content = await file.text();

        filesForAI.push({
          path,
          content: content.slice(0, MAX_FILE_SIZE),
        });

        totalSize += Math.min(
          content.length,
          MAX_FILE_SIZE
        );
      } catch {
        filesForAI.push({
          path,
          content: "[Unable to read file]",
        });
      }
    }

    return filesForAI;
  };

  /*
   * Select project folder.
   */
  const handleFolderSelect = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files || []);

    setSelectedFiles(files);
    setError("");
    setSuccessMessage("");
    setResults({});
  };

  /*
   * Call the backend AI agent.
   */
  const createAgentResult = async (
    agentName: string,
    ctx: ProjectContext
  ): Promise<AgentResult> => {
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentName,
          fileList: ctx.fileList,
          files: ctx.filesForAI,
        }),
      });

      let result: any;

      try {
        result = await response.json();
      } catch {
        throw new Error(
          `Server returned an invalid response (${response.status})`
        );
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "AI agent request failed."
        );
      }

      return {
        agentName,
        status: "success",
        data: result.data,
        logs:
          result.logs || [
            `${agentName} completed successfully.`,
          ],
      };
    } catch (err: any) {
      return {
        agentName,
        status: "error",
        data: err?.message || "Unknown error",
        logs: [
          `${agentName} failed: ${
            err?.message || "Unknown error"
          }`,
        ],
      };
    }
  };

  /*
   * Run all AI agents.
   */
  const runPipeline = async () => {
    setError("");
    setSuccessMessage("");
    setResults({});

    if (!githubUsername.trim()) {
      setError("Please enter your GitHub username.");
      return;
    }

    if (!repoName.trim()) {
      setError("Please enter a repository name.");
      return;
    }

    if (!githubToken.trim()) {
      setError("Please enter your GitHub Personal Access Token.");
      return;
    }

    if (selectedFiles.length === 0) {
      setError("Please select a project folder.");
      return;
    }

    setIsRunning(true);

    try {
      /*
       * Build project file list.
       */
      const fileList = selectedFiles
        .map(
          (file) =>
            (file as any).webkitRelativePath || file.name
        )
        .join("\n");

      /*
       * Read actual source-code contents.
       */
      setCurrentAgent("Preparing project files...");

      const filesForAI = await readFilesForAI(
        selectedFiles
      );

      const ctx: ProjectContext = {
        fileList,
        filesForAI,
      };

      /*
       * Run AI agents one by one.
       */
      for (const agent of agents) {
        setCurrentAgent(agent.name);

        const result = await createAgentResult(
          agent.name,
          ctx
        );

        setResults((previous) => ({
          ...previous,
          [agent.name]: result,
        }));

        /*
         * Stop if an AI agent fails.
         */
        if (result.status === "error") {
          setError(
            `${agent.name} failed: ${result.data}`
          );

          setIsRunning(false);
          setCurrentAgent("");
          return;
        }
      }

      /*
       * Upload project to GitHub.
       */
      setCurrentAgent("Uploading project to GitHub...");

      const formData = new FormData();

      formData.append(
        "githubUsername",
        githubUsername.trim()
      );

      formData.append("repoName", repoName.trim());

      formData.append("githubToken", githubToken.trim());

      formData.append("visibility", visibility);

      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });

      const deployResponse = await fetch(
        "/api/deploy",
        {
          method: "POST",
          body: formData,
        }
      );

      let deployResult: any;

      try {
        deployResult = await deployResponse.json();
      } catch {
        throw new Error(
          `Deployment server returned an invalid response (${deployResponse.status})`
        );
      }

      if (
        !deployResponse.ok ||
        !deployResult.success
      ) {
        throw new Error(
          deployResult.error ||
            "GitHub deployment failed."
        );
      }

      /*
       * Mark deployment agent as successful.
       */
      setResults((previous) => ({
        ...previous,
        "Deployment Agent": {
          agentName: "Deployment Agent",
          status: "success",
          data: deployResult,
          logs: [
            "Project uploaded successfully.",
            deployResult.message ||
              "GitHub repository created successfully.",
          ],
        },
      }));

      setSuccessMessage(
        `Project deployed successfully to GitHub: ${githubUsername}/${repoName}`
      );

      /*
       * Optional issue creation.
       */
      try {
        const issueResults = Object.values(results)
          .filter(
            (result) =>
              result.status === "success"
          )
          .map((result) => ({
            agentName: result.agentName,
            data: result.data,
          }));

        await fetch("/api/issues", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            githubUsername:
              githubUsername.trim(),
            repoName: repoName.trim(),
            githubToken: githubToken.trim(),
            results: issueResults,
          }),
        });
      } catch {
        /*
         * Issue creation should not make
         * an otherwise successful deployment fail.
         */
      }
    } catch (err: any) {
      setError(
        err?.message ||
          "Something went wrong while running the pipeline."
      );
    } finally {
      setIsRunning(false);
      setCurrentAgent("");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600">
              <Bot size={25} />
            </div>

            <div>
              <h1 className="text-xl font-bold">
                AgentForge AI
              </h1>

              <p className="text-xs text-slate-400">
                Multi-Agent DevOps Platform
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300">
            <Sparkles size={16} />
            AI Powered
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        {/* Hero */}
        <section className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-300">
            <Bot size={16} />
            Autonomous DevOps Agents
          </div>

          <h2 className="text-4xl font-bold tracking-tight md:text-5xl">
            Analyze. Improve. Deploy.
          </h2>

          <p className="mx-auto mt-4 max-w-2xl text-slate-400">
            Upload your project and let AI agents analyze
            your code, check security, prepare DevOps
            configuration and deploy your project to GitHub.
          </p>
        </section>

        {/* Error */}
        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            <AlertTriangle
              size={20}
              className="mt-0.5 shrink-0"
            />

            <div>
              <p className="font-semibold">
                Pipeline error
              </p>

              <p className="mt-1 text-sm">
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Success */}
        {successMessage && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-green-300">
            <CheckCircle2
              size={20}
              className="mt-0.5 shrink-0"
            />

            <div>
              <p className="font-semibold">
                Deployment successful
              </p>

              <p className="mt-1 text-sm">
                {successMessage}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Configuration */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="mb-6 flex items-center gap-3">
              <GitBranch size={22} />

              <div>
                <h3 className="font-semibold">
                  GitHub Configuration
                </h3>

                <p className="text-sm text-slate-400">
                  Configure where your project will be deployed.
                </p>
              </div>
            </div>

            <div className="space-y-5">
              {/* Username */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  GitHub Username
                </label>

                <input
                  type="text"
                  value={githubUsername}
                  onChange={(e) =>
                    setGithubUsername(e.target.value)
                  }
                  placeholder="your-github-username"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-indigo-500"
                />
              </div>

              {/* Repository */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Repository Name
                </label>

                <input
                  type="text"
                  value={repoName}
                  onChange={(e) =>
                    setRepoName(e.target.value)
                  }
                  placeholder="my-ai-project"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-indigo-500"
                />
              </div>

              {/* Token */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  GitHub Personal Access Token
                </label>

                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) =>
                    setGithubToken(e.target.value)
                  }
                  placeholder="github_pat_..."
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none transition focus:border-indigo-500"
                />

                <p className="mt-2 text-xs text-slate-500">
                  Your token is used for this deployment request.
                  Never commit it to your repository.
                </p>
              </div>

              {/* Visibility */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Repository Visibility
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setVisibility("public")
                    }
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      visibility === "public"
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                        : "border-slate-700 bg-slate-950 text-slate-400"
                    }`}
                  >
                    Public
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setVisibility("private")
                    }
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                      visibility === "private"
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                        : "border-slate-700 bg-slate-950 text-slate-400"
                    }`}
                  >
                    Private
                  </button>
                </div>
              </div>

              {/* Folder */}
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Project Folder
                </label>

                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950 px-6 py-10 text-center transition hover:border-indigo-500 hover:bg-indigo-500/5">
                  <FolderOpen
                    size={35}
                    className="mb-3 text-indigo-400"
                  />

                  <span className="font-medium">
                    Choose Project Folder
                  </span>

                  <span className="mt-1 text-xs text-slate-500">
                    Select the folder containing your project
                  </span>

                  <input
                    type="file"
                    multiple
                    // @ts-ignore
                    webkitdirectory=""
                    directory=""
                    onChange={handleFolderSelect}
                    className="hidden"
                  />
                </label>

                {selectedFiles.length > 0 && (
                  <div className="mt-3 rounded-lg bg-slate-950 p-3 text-sm text-slate-400">
                    <div className="flex items-center gap-2">
                      <CheckCircle2
                        size={16}
                        className="text-green-400"
                      />

                      {selectedFiles.length} files selected
                    </div>
                  </div>
                )}
              </div>

              {/* Run */}
              <button
                type="button"
                onClick={runPipeline}
                disabled={isRunning}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 font-semibold transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRunning ? (
                  <>
                    <Loader2
                      size={19}
                      className="animate-spin"
                    />
                    Running {currentAgent || "Pipeline"}...
                  </>
                ) : (
                  <>
                    <Rocket size={19} />
                    Analyze & Deploy
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Agents */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="mb-6">
              <h3 className="font-semibold">
                AI Agent Pipeline
              </h3>

              <p className="mt-1 text-sm text-slate-400">
                Each agent analyzes a different part of your
                project.
              </p>
            </div>

            <div className="space-y-3">
              {agents.map((agent, index) => {
                const result = results[agent.name];

                const isCurrent =
                  currentAgent === agent.name;

                return (
                  <div
                    key={agent.name}
                    className={`rounded-xl border p-4 transition ${
                      isCurrent
                        ? "border-indigo-500/50 bg-indigo-500/5"
                        : "border-slate-800 bg-slate-950/50"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Number */}
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-sm font-bold text-slate-400">
                        {index + 1}
                      </div>

                      {/* Icon */}
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                        {agent.icon}
                      </div>

                      {/* Information */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">
                            {agent.name}
                          </h4>

                          {isCurrent && (
                            <Loader2
                              size={15}
                              className="animate-spin text-indigo-400"
                            />
                          )}
                        </div>

                        <p className="mt-1 text-xs text-slate-500">
                          {agent.description}
                        </p>
                      </div>

                      {/* Status */}
                      <div>
                        {result?.status ===
                          "success" && (
                          <CheckCircle2
                            size={21}
                            className="text-green-400"
                          />
                        )}

                        {result?.status ===
                          "error" && (
                          <XCircle
                            size={21}
                            className="text-red-400"
                          />
                        )}

                        {!result &&
                          !isCurrent && (
                            <div className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                          )}

                        {isCurrent && !result && (
                          <Loader2
                            size={21}
                            className="animate-spin text-indigo-400"
                          />
                        )}
                      </div>
                    </div>

                    {/* Logs */}
                    {result?.logs &&
                      result.logs.length > 0 && (
                        <div className="mt-3 rounded-lg bg-slate-900 p-3">
                          {result.logs.map(
                            (log, logIndex) => (
                              <p
                                key={logIndex}
                                className="text-xs text-slate-400"
                              >
                                {log}
                              </p>
                            )
                          )}
                        </div>
                      )}

                    {/* AI output */}
                    {result?.status ===
                      "success" &&
                      result.data && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-medium text-indigo-400">
                            View AI analysis
                          </summary>

                          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-slate-400">
                            {typeof result.data ===
                            "string"
                              ? result.data
                              : result.data.analysis ||
                                JSON.stringify(
                                  result.data,
                                  null,
                                  2
                                )}
                          </pre>
                        </details>
                      )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* How it works */}
        <section className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
          <div className="grid gap-6 md:grid-cols-4">
            <div>
              <Upload
                size={22}
                className="mb-3 text-indigo-400"
              />

              <h4 className="font-semibold">
                1. Upload
              </h4>

              <p className="mt-1 text-sm text-slate-500">
                Select your project folder.
              </p>
            </div>

            <div>
              <Bot
                size={22}
                className="mb-3 text-indigo-400"
              />

              <h4 className="font-semibold">
                2. Analyze
              </h4>

              <p className="mt-1 text-sm text-slate-500">
                AI agents inspect your source code.
              </p>
            </div>

            <div>
              <ShieldCheck
                size={22}
                className="mb-3 text-indigo-400"
              />

              <h4 className="font-semibold">
                3. Validate
              </h4>

              <p className="mt-1 text-sm text-slate-500">
                Security and DevOps checks are performed.
              </p>
            </div>

            <div>
              <Rocket
                size={22}
                className="mb-3 text-indigo-400"
              />

              <h4 className="font-semibold">
                4. Deploy
              </h4>

              <p className="mt-1 text-sm text-slate-500">
                Your project is pushed to GitHub.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default App;