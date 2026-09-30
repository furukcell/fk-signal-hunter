import fs from "node:fs/promises";
import path from "node:path";

async function listHistoricalFiles(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
      .map(entry => entry.name)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readHistoricalRows({ directory = "./data/historical", date, limit = 200000 } = {}) {
  const files = date
    ? [`${date}.jsonl`]
    : await listHistoricalFiles(directory);

  const rows = [];
  for (const file of files) {
    const filePath = path.join(directory, file);
    let content;
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        // Ignore an incomplete/corrupt final line so one bad record does not abort a backtest.
      }
      if (rows.length >= limit) return rows;
    }
  }

  return rows;
}

async function historicalSummary(directory = "./data/historical") {
  const files = await listHistoricalFiles(directory);
  const stats = [];

  for (const file of files) {
    const filePath = path.join(directory, file);
    const stat = await fs.stat(filePath);
    stats.push({ date: file.slice(0, 10), file, bytes: stat.size });
  }

  return {
    directory,
    files: stats,
    totalFiles: stats.length,
    totalBytes: stats.reduce((sum, x) => sum + x.bytes, 0)
  };
}

export { listHistoricalFiles, readHistoricalRows, historicalSummary };
