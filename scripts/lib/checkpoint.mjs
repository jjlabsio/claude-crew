import { execFile } from "node:child_process";

export class CheckpointError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckpointError";
  }
}

export async function checkpoint({ message, cwd }) {
  const workDir = cwd ?? process.cwd();

  await git(["add", "-A"], workDir);

  const status = await git(["status", "--porcelain"], workDir);
  if (status.trim() === "") {
    return { committed: false, hash: null, message: null };
  }

  await git(["commit", "--no-verify", "-m", message], workDir);

  const hash = (await git(["rev-parse", "--short", "HEAD"], workDir)).trim();
  return { committed: true, hash, message };
}

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new CheckpointError(`git ${args[0]} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}
