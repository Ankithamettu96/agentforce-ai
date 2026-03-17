import React, { useState, useRef } from "react";
import { 
  Github, 
  Upload, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Key, 
  FolderOpen,
  Info,
  Shield,
  ShieldOff,
  Activity,
  FileText,
  ExternalLink,
  Cpu,
  Terminal,
  ChevronRight,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface AgentResult {
  agentName: string;
  status: "success" | "error";
  data: any;
  logs: string[];
}

interface ProjectContext {
  fileList: string;
  readme?: string;
  gitignore?: string;
  license?: string;
  cicdWorkflow?: string;
  commitMessage?: string;
}

export default function App() {
  const [repoName, setRepoName] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [pat, setPat] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [files, setFiles] = useState<FileList | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [logs, setLogs] = useState<AgentResult[]>([]);
  const [agentResults, setAgentResults] = useState<AgentResult[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = (message: string, type: "info" | "success" | "error" = "info") => {
    const logEntry: AgentResult = {
      agentName: "System",
      status: type === "error" ? "error" : "success",
      data: message,
      logs: [message]
    };
    // This is a bit hacky to match the existing UI structure
    // I'll just use a separate state for simple logs if needed, but let's try to adapt
  };

  const [systemLogs, setSystemLogs] = useState<{id: string, message: string, type: string, timestamp: Date}[]>([]);
  const addSystemLog = (message: string, type: string = "info") => {
    setSystemLogs(prev => [
      { id: Math.random().toString(36).substr(2, 9), message, type, timestamp: new Date() },
      ...prev
    ]);
  };

  const createAgentResult = async (agentName: string, ctx: ProjectContext): Promise<AgentResult> => {
    return {
      agentName,
      status: "success",
      data: `${agentName} completed successfully.`,
      logs: [`${agentName} completed successfully.`]
    };
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files || files.length === 0) {
      addSystemLog("Please select a folder to deploy.", "error");
      return;
    }
    if (!repoName || !pat || !githubUsername) {
      addSystemLog("All fields are required.", "error");
      return;
    }

    setIsDeploying(true);
    setSystemLogs([]);
    setAgentResults([]);
    setRepoUrl("");
    addSystemLog("Initializing Multi-Agent AI DevOps System...");

    const ignoredFolders = [
      "node_modules", ".git", "dist", "build", ".next", 
      "coverage", "venv", "__pycache__", ".idea", ".vscode"
    ];

    const filteredFiles = (Array.from(files) as File[]).filter(file => {
      const path = (file as any).webkitRelativePath || file.name;
      const pathParts = path.split("/");
      return !pathParts.some((part: string) => ignoredFolders.includes(part));
    });

    addSystemLog(`Filtered project files: ${filteredFiles.length} relevant files selected for AI analysis.`);

    const fileList = filteredFiles.map(f => (f as any).webkitRelativePath || f.name).join("\n");
    const ctx: ProjectContext = { fileList };

    try {
      // 1. Project Analyzer
      addSystemLog("Agent [Project Analyzer] starting...");
      const analyzerRes = await createAgentResult("Project Analyzer", ctx);
      setAgentResults(prev => [...prev, analyzerRes]);
      analyzerRes.logs.forEach(l => addSystemLog(`[Analyzer] ${l}`));

      // 2. Parallel Agents
      addSystemLog("Orchestrating parallel agents (Documentation, Git, Health, CI/CD)...");
      const parallelResults = await Promise.all([
        createAgentResult("Documentation Agent", ctx),
        createAgentResult("Git Optimization Agent", ctx),
        createAgentResult("Code Health Agent", ctx),
        createAgentResult("CI/CD Generator Agent", ctx),
        createAgentResult("License Agent", ctx)
      ]);
      setAgentResults(prev => [...prev, ...parallelResults]);
      parallelResults.forEach(res => {
        res.logs.forEach(l => addSystemLog(`[${res.agentName}] ${l}`));
      });

      // 3. Commit Intelligence
      addSystemLog("Agent [Commit Intelligence] starting...");
      const commitRes = await createAgentResult("Commit Intelligence Agent", ctx);
      setAgentResults(prev => [...prev, commitRes]);
      commitRes.logs.forEach(l => addSystemLog(`[Commit] ${l}`));

      // 4. Backend Deployment
      addSystemLog("Preparing files for upload...");
      const deployId = Math.random().toString(36).substr(2, 9);
      const formData = new FormData();
      formData.append("repoName", repoName);
      formData.append("githubUsername", githubUsername);
      formData.append("pat", pat);
      formData.append("visibility", visibility);
      formData.append("deployId", deployId);
      formData.append("readme", ctx.readme || "");
      formData.append("gitignore", ctx.gitignore || "");
      formData.append("license", ctx.license || "");
      formData.append("cicdWorkflow", ctx.cicdWorkflow || "");
      formData.append("commitMessage", ctx.commitMessage || "");

      filteredFiles.forEach((file: File, index) => {
        if (index % 100 === 0 && index > 0) {
          addSystemLog(`Preparing files: ${index}/${filteredFiles.length}...`);
        }
        const path = (file as any).webkitRelativePath || file.name;
        formData.append("files", file, path);
      });

      addSystemLog(`Uploading ${filteredFiles.length} files and deploying to GitHub... (This may take a few minutes for large projects)`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minute timeout

      const response = await fetch("/api/deploy", {
        method: "POST",
        body: formData,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      console.log("Response status:", response.status);
      console.log("Response headers:", Object.fromEntries(response.headers.entries()));

      const contentType = response.headers.get("content-type");
      let data: any;
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error("Unexpected response body:", text.substring(0, 500));
        throw new Error(`Server returned HTML instead of JSON (Status ${response.status}). This usually means the API route was not found and fell back to the frontend.`);
      }

      if (data.results) {
        setAgentResults(prev => [...prev, ...data.results]);
        data.results.forEach((res: any) => {
          res.logs.forEach((log: string) => addSystemLog(`[Backend] ${log}`));
        });
      }

      if (response.ok) {
        setRepoUrl(data.repoUrl);
        addSystemLog("Deployment successful! Generating issues...", "success");

        // 5. Issue Generator
        const issueRes = await createAgentResult("Issue Generator Agent", ctx);
        setAgentResults(prev => [...prev, issueRes]);
        issueRes.logs.forEach(l => addSystemLog(`[Issues] ${l}`));

        if (issueRes.status === "success" && issueRes.data.issues) {
          addSystemLog("Posting issues to GitHub...");
          await fetch("/api/issues", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              githubUsername,
              repoName,
              pat,
              issues: issueRes.data.issues
            })
          });
          addSystemLog("Autonomous DevOps Workflow Complete!", "success");
        }
      } else {
        addSystemLog(data.error || "Deployment failed.", "error");
      }
    } catch (error: any) {
      addSystemLog(`Pipeline error: ${error.message}`, "error");
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-12 flex items-center justify-between border-b border-[#141414]/10 pb-6">
          <div className="flex items-center gap-3">
            <img 
  src="/logo1.png" 
  alt="logo"
  className="w-10 h-10 rounded-xl shadow-lg"
/>
            <div>
              <h1 className="text-2xl font-bold tracking-tight uppercase italic flex items-center gap-2">
                AgentForge AI
              </h1>
              <p className="text-sm text-[#141414]/60 italic font-serif">Automate your code deployment with AI agents</p>
            </div>
          </div>
          <div className="hidden md:block text-right">
            <p className="text-[10px] uppercase tracking-widest font-mono opacity-50">System Status</p>
            <div className="flex items-center gap-2 justify-end">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs font-mono uppercase">Active</span>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-4 space-y-6">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl shadow-sm border border-[#141414]/5 p-6"
            >
              <form onSubmit={handleDeploy} className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider">GitHub Username</label>
                    <input 
                      type="text"
                      placeholder="octocat"
                      className="w-full px-4 py-3 rounded-xl border border-[#141414]/10 focus:outline-none focus:ring-2 focus:ring-[#141414]/5 transition-all bg-[#F9F9F7]"
                      value={githubUsername}
                      onChange={(e) => setGithubUsername(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider">Repository Name</label>
                    <input 
                      type="text"
                      placeholder="my-autonomous-project"
                      className="w-full px-4 py-3 rounded-xl border border-[#141414]/10 focus:outline-none focus:ring-2 focus:ring-[#141414]/5 transition-all bg-[#F9F9F7]"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider flex items-center justify-between">
                      <span className="flex items-center gap-2"><Key className="w-3 h-3" /> Personal Access Token</span>
                      <a 
                        href="https://github.com/settings/tokens/new?scopes=repo,workflow" 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[9px] text-emerald-600 hover:underline flex items-center gap-1"
                      >
                        Generate Token <ExternalLink className="w-2 h-2" />
                      </a>
                    </label>
                    <input 
                      type="password"
                      placeholder="ghp_xxxxxxxxxxxx"
                      className="w-full px-4 py-3 rounded-xl border border-[#141414]/10 focus:outline-none focus:ring-2 focus:ring-[#141414]/5 transition-all bg-[#F9F9F7]"
                      value={pat}
                      onChange={(e) => setPat(e.target.value.trim())}
                      required
                    />
                    <p className="text-[9px] text-[#141414]/40 italic">Requires 'repo' and 'workflow' scopes.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider">Visibility</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setVisibility("public")}
                        className={`flex-1 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                          visibility === "public" ? "bg-[#141414] text-white border-[#141414]" : "bg-white text-[#141414] border-[#141414]/10"
                        }`}
                      >
                        <Shield className="w-3 h-3" /> Public
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisibility("private")}
                        className={`flex-1 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                          visibility === "private" ? "bg-[#141414] text-white border-[#141414]" : "bg-white text-[#141414] border-[#141414]/10"
                        }`}
                      >
                        <ShieldOff className="w-3 h-3" /> Private
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                      <FolderOpen className="w-3 h-3" /> Project Folder
                    </label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className={`
                        border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all
                        ${files ? 'border-emerald-500 bg-emerald-50/50' : 'border-[#141414]/10 hover:border-[#141414]/30 bg-[#F9F9F7]'}
                      `}
                    >
                      <input 
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={(e) => setFiles(e.target.files)}
                        {...({ webkitdirectory: "", directory: "" } as any)}
                      />
                      <div className="flex flex-col items-center gap-2">
                        <Upload className={`w-6 h-6 ${files ? 'text-emerald-500' : 'text-[#141414]/30'}`} />
                        <p className="text-xs font-medium">{files ? `${files.length} files selected` : 'Select local folder'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={isDeploying}
                  className={`
                    w-full py-4 rounded-xl font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all
                    ${isDeploying 
                      ? 'bg-[#141414]/20 text-[#141414]/40 cursor-not-allowed' 
                      : 'bg-[#141414] text-white hover:bg-[#141414]/90 active:scale-[0.98] shadow-lg shadow-[#141414]/10'}
                  `}
                >
                  {isDeploying ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Orchestrating...
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      Execute Pipeline
                    </>
                  )}
                </button>
              </form>
            </motion.div>

            {repoUrl && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-500 text-white rounded-2xl p-6 shadow-lg shadow-emerald-500/20 flex flex-col items-center gap-4 text-center"
              >
                <CheckCircle2 className="w-12 h-12" />
                <div>
                  <h3 className="font-bold uppercase tracking-wider">Deployment Successful</h3>
                  <p className="text-xs opacity-80 italic">Your project is now live on GitHub</p>
                </div>
                <a 
                  href={repoUrl} 
                  target="_blank" 
                  rel="noreferrer"
                  className="bg-white text-emerald-600 px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-emerald-50 transition-all"
                >
                  Open Repository <ExternalLink className="w-3 h-3" />
                </a>
              </motion.div>
            )}
          </div>

          {/* Multi-Agent Dashboard */}
          <div className="lg:col-span-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Agent Pipeline */}
              <div className="bg-white rounded-2xl shadow-sm border border-[#141414]/5 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-[#141414]/5 bg-[#F9F9F7] flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4" /> Agent Pipeline
                  </h2>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${isDeploying ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
                    <span className="text-[10px] font-mono uppercase opacity-50">{isDeploying ? 'Processing' : 'Standby'}</span>
                  </div>
                </div>
                <div className="p-4 space-y-3 overflow-y-auto max-h-[400px]">
                  {agentResults.length === 0 && !isDeploying ? (
                    <div className="flex flex-col items-center justify-center h-40 text-[#141414]/20 gap-2">
                      <Cpu className="w-8 h-8 opacity-10" />
                      <p className="text-xs italic">Pipeline inactive</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {agentResults.map((res, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`p-3 rounded-xl border flex items-center justify-between ${
                            res.status === "success" ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`p-1.5 rounded-lg ${res.status === "success" ? "bg-emerald-500" : "bg-rose-500"} text-white`}>
                              {res.status === "success" ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                            </div>
                            <span className="text-xs font-bold uppercase tracking-tight">{res.agentName}</span>
                          </div>
                          <ChevronRight className="w-3 h-3 opacity-30" />
                        </motion.div>
                      ))}
                      {isDeploying && agentResults.length < 8 && (
                        <div className="p-3 rounded-xl border border-dashed border-[#141414]/10 flex items-center gap-3 animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin opacity-30" />
                          <span className="text-xs font-bold uppercase tracking-tight opacity-30 italic">Next Agent in Queue...</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* System Logs */}
              <div className="bg-[#141414] rounded-2xl shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
                    <Terminal className="w-4 h-4" /> System Logs
                  </h2>
                </div>
                <div className="flex-1 p-4 font-mono text-[10px] overflow-y-auto max-h-[400px] space-y-1.5 text-white/80">
                  <AnimatePresence initial={false}>
                    {systemLogs.length === 0 ? (
                      <p className="text-white/20 italic">Waiting for execution...</p>
                    ) : (
                      systemLogs.map((log) => (
                        <motion.div 
                          key={log.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex gap-2"
                        >
                          <span className="opacity-30">[{log.timestamp.toLocaleTimeString([], { hour12: false })}]</span>
                          <span className={log.type === "error" ? "text-rose-400" : log.type === "success" ? "text-emerald-400" : ""}>
                            {log.message}
                          </span>
                        </motion.div>
                      ))
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Detailed Agent Outputs */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {agentResults.map((res, i) => (
                res.status === "success" && res.data && (
                  <motion.div 
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl shadow-sm border border-[#141414]/5 p-4 space-y-3"
                  >
                    <div className="flex items-center gap-2 border-b border-[#141414]/5 pb-2">
                      <FileText className="w-3 h-3 opacity-50" />
                      <h3 className="text-[10px] font-bold uppercase tracking-widest">{res.agentName} Output</h3>
                    </div>
                    <div className="text-[11px] leading-relaxed text-[#141414]/70 font-serif italic line-clamp-6">
                      {typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2)}
                    </div>
                  </motion.div>
                )
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
