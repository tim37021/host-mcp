import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import TurndownService from "turndown";
import mime from "mime-types";

const execAsync = promisify(exec);

// Allowed directories to restrict operations
let allowedDirectories: string[] = [];

/**
 * Checks if an absolute path is within any of the allowed directories.
 */
function isPathWithinAllowedDirectories(absolutePath: string, allowedDirs: string[]): boolean {
  if (typeof absolutePath !== "string" || !Array.isArray(allowedDirs)) {
    return false;
  }
  if (!absolutePath || allowedDirs.length === 0) {
    return false;
  }
  if (absolutePath.includes("\x00")) {
    return false;
  }

  let normalizedPath: string;
  try {
    normalizedPath = path.resolve(path.normalize(absolutePath));
  } catch {
    return false;
  }

  if (!path.isAbsolute(normalizedPath)) {
    throw new Error("Path must be absolute after normalization");
  }

  return allowedDirs.some((dir) => {
    if (typeof dir !== "string" || !dir || dir.includes("\x00")) {
      return false;
    }

    let normalizedDir: string;
    try {
      normalizedDir = path.resolve(path.normalize(dir));
    } catch {
      return false;
    }

    if (!path.isAbsolute(normalizedDir)) {
      throw new Error("Allowed directories must be absolute paths after normalization");
    }

    if (normalizedPath === normalizedDir) {
      return true;
    }

    if (normalizedDir === path.sep) {
      return normalizedPath.startsWith(path.sep);
    }

    if (path.sep === "\\" && normalizedDir.match(/^[A-Za-z]:\\?$/)) {
      const dirDrive = normalizedDir.charAt(0).toLowerCase();
      const pathDrive = normalizedPath.charAt(0).toLowerCase();
      return (
        pathDrive === dirDrive &&
        normalizedPath.startsWith(normalizedDir.replace(/\\?$/, "\\"))
      );
    }

    return normalizedPath.startsWith(normalizedDir + path.sep);
  });
}

/**
 * Validates that a requested path is safe and within allowed directories.
 */
async function validatePath(requestedPath: string): Promise<string> {
  const absolutePath = path.resolve(requestedPath);
  if (!isPathWithinAllowedDirectories(absolutePath, allowedDirectories)) {
    throw new Error(`Access denied: Path ${absolutePath} is outside allowed directories. Use the 'get_allowed_directories' tool to see which directories are permitted.`);
  }
  
  try {
    await fs.stat(absolutePath);
    // Path exists, return the absolute path
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Path does not exist: ${absolutePath}`);
    }
    throw error;
  }
  
  return absolutePath;
}

function createMcpServer() {
  const server = new Server(
  {
    name: "Host",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_allowed_directories",
        description: "Returns the list of directories that this server is allowed to access. Any filesystem operation outside these directories will fail.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "read_file",
        description: "Read the contents of a file on the host filesystem. Access is restricted to allowed directories.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute or relative path to the file to read",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "list_directory",
        description: "List the contents of a directory on the host filesystem. Access is restricted to allowed directories.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute or relative path to the directory to list",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        description: "Write content to a file on the host filesystem. Access is restricted to allowed directories.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute or relative path to the file to write",
            },
            content: {
              type: "string",
              description: "The content to write to the file",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "edit_file",
        description: "Edit a file on the host filesystem by replacing exact string occurrences. Access is restricted to allowed directories.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute or relative path to the file to edit",
            },
            edits: {
              type: "array",
              description: "An array of edit operations. Use 'edits' for multiple replacements, or 'old_string'/'new_string' for a single replacement.",
              items: {
                type: "object",
                properties: {
                  old_string: { type: "string", description: "The exact string to replace" },
                  new_string: { type: "string", description: "The string to replace it with" },
                },
                required: ["old_string", "new_string"],
              },
            },
            old_string: {
              type: "string",
              description: "The exact string to replace (legacy/single edit)",
            },
            new_string: {
              type: "string",
              description: "The string to replace it with (legacy/single edit)",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "run_command",
        description: "Execute a shell command on the host machine. If a working directory (cwd) is provided, it must be within allowed directories.",
        inputSchema: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
            cwd: {
              type: "string",
              description: "Optional working directory to run the command in",
            },
          },
          required: ["command"],
          },
          },
          {
          name: "fetch",
          description: "Fetch a URL and return its content. If the content is HTML, it will be converted to Markdown.",
          inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL to fetch",
            },
            raw: {
              type: "boolean",
              description: "If true, return the raw content without Markdown conversion",
              default: false,
            },
            ignore_images: {
              type: "boolean",
              description: "If true, ignore images during Markdown conversion",
              default: false,
            },
          },
          required: ["url"],
          },
          },
          ],
          };
          });
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_allowed_directories") {
    return {
      content: [
        {
          type: "text",
          text: `Allowed directories configured for this server:\n${allowedDirectories.join("\n")}`,
        },
      ],
    };
  }

  if (name === "read_file") {
    const parsedArgs = z.object({ path: z.string() }).safeParse(args);
    if (!parsedArgs.success) {
      throw new Error("Invalid arguments for read_file");
    }

    try {
      const validPath = await validatePath(parsedArgs.data.path);
      const stat = await fs.stat(validPath);
      if (!stat.isFile()) {
        throw new Error("Path is not a file");
      }
      
      let mimeType = mime.lookup(validPath) || "application/octet-stream";
      if (validPath.endsWith(".ts") || validPath.endsWith(".tsx")) {
        mimeType = "application/typescript";
      }
      
      const buffer = await fs.readFile(validPath);
      const isText = !buffer.subarray(0, 8000).includes(0);

      if (isText) {
        return {
          content: [{ type: "text", text: buffer.toString("utf-8") }],
        };
      }

      // If it's a binary file and an image, return it as ImageContent
      if (mimeType.startsWith("image/")) {
        return {
          content: [{
            type: "image",
            data: buffer.toString("base64"),
            mimeType: mimeType
          }]
        };
      }
      
      // Other binary files (PDFs, audio, video, etc.) returned as EmbeddedResource
      return {
        content: [{
          type: "resource",
          resource: {
            uri: `file://${validPath}`,
            mimeType: mimeType,
            blob: buffer.toString("base64")
          }
        }]
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error reading file: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === "list_directory") {
    const parsedArgs = z.object({ path: z.string() }).safeParse(args);
    if (!parsedArgs.success) {
      throw new Error("Invalid arguments for list_directory");
    }

    try {
      const validPath = await validatePath(parsedArgs.data.path);
      const stat = await fs.stat(validPath);
      if (!stat.isDirectory()) {
        throw new Error("Path is not a directory");
      }
      const files = await fs.readdir(validPath, { withFileTypes: true });
      const entries = files.map((file) => {
        return `${file.isDirectory() ? "[DIR]" : "[FILE]"} ${file.name}`;
      });
      return {
        content: [{ type: "text", text: entries.length > 0 ? entries.join("\n") : "(empty directory)" }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error listing directory: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === "write_file") {
    const parsedArgs = z.object({ path: z.string(), content: z.string() }).safeParse(args);
    if (!parsedArgs.success) {
      throw new Error("Invalid arguments for write_file");
    }

    try {
      // Validate path directly (it might not exist yet, so we don't use validatePath which checks for existence)
      const absolutePath = path.resolve(parsedArgs.data.path);
      if (!isPathWithinAllowedDirectories(absolutePath, allowedDirectories)) {
        throw new Error(`Access denied: Path ${absolutePath} is outside allowed directories. Use the 'get_allowed_directories' tool to see which directories are permitted.`);
      }
      
      await fs.writeFile(absolutePath, parsedArgs.data.content, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully wrote to ${absolutePath}` }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error writing file: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === "edit_file") {
    const parsedArgs = z.object({ 
      path: z.string(), 
      edits: z.array(z.object({
        old_string: z.string(),
        new_string: z.string()
      })).optional(),
      old_string: z.string().optional(),
      new_string: z.string().optional()
    }).safeParse(args);
    
    if (!parsedArgs.success) {
      throw new Error("Invalid arguments for edit_file");
    }

    const { path: filePath, edits, old_string, new_string } = parsedArgs.data;
    const finalEdits = edits || [];
    
    if (old_string !== undefined && new_string !== undefined) {
      finalEdits.push({ old_string, new_string });
    }
    
    if (finalEdits.length === 0) {
      return {
        content: [{ type: "text", text: `Error: You must provide either an 'edits' array or 'old_string' and 'new_string'.` }],
        isError: true,
      };
    }

    try {
      const validPath = await validatePath(filePath);
      const stat = await fs.stat(validPath);
      if (!stat.isFile()) {
        throw new Error("Path is not a file");
      }
      
      let content = await fs.readFile(validPath, "utf-8");
      let totalOccurrences = 0;
      
      for (const edit of finalEdits) {
        if (!content.includes(edit.old_string)) {
           return {
            content: [{ type: "text", text: `Error: The string to replace:\n\n${edit.old_string}\n\n...was not found in the file. No changes were made.` }],
            isError: true,
          };
        }
        
        const occurrences = content.split(edit.old_string).length - 1;
        totalOccurrences += occurrences;
        content = content.split(edit.old_string).join(edit.new_string);
      }
      
      await fs.writeFile(validPath, content, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully applied ${finalEdits.length} edit(s), replacing ${totalOccurrences} occurrence(s) in ${validPath}` }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error editing file: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === "run_command") {
    const parsedArgs = z
      .object({ command: z.string(), cwd: z.string().optional() })
      .safeParse(args);
    if (!parsedArgs.success) {
      throw new Error("Invalid arguments for run_command");
    }

    try {
      let runCwd: string | undefined = undefined;
      
      // If cwd is provided, validate it against allowed directories
      if (parsedArgs.data.cwd) {
        runCwd = await validatePath(parsedArgs.data.cwd);
        const stat = await fs.stat(runCwd);
        if (!stat.isDirectory()) {
          throw new Error("cwd is not a directory");
        }
      } else {
        // If no cwd is provided, check if the default process.cwd() is allowed.
        // If it's not allowed, we don't necessarily want to completely fail,
        // but it's safer to ensure they only run commands where permitted.
        const defaultCwd = process.cwd();
        if (!isPathWithinAllowedDirectories(defaultCwd, allowedDirectories)) {
          // If the default working directory is outside allowed bounds,
          // require an explicit allowed cwd.
          throw new Error("Current working directory is outside allowed directories. Please provide a valid 'cwd' argument within the allowed directories.");
        }
        runCwd = defaultCwd;
      }

      const { stdout, stderr } = await execAsync(parsedArgs.data.command, {
        cwd: runCwd,
      });
      
      const output = [
        stdout ? `STDOUT:\n${stdout}` : "",
        stderr ? `STDERR:\n${stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      return {
        content: [{ type: "text", text: output || "Command executed successfully with no output." }],
      };
    } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Command failed: ${error.message}\nSTDOUT:\n${error.stdout || ""}\nSTDERR:\n${error.stderr || ""}`,
        },
      ],
      isError: true,
    };
    }
    }

    if (name === "fetch") {
    const parsedArgs = z.object({ 
    url: z.string().url(),
    raw: z.boolean().optional().default(false),
    ignore_images: z.boolean().optional().default(false)
    }).safeParse(args);

    if (!parsedArgs.success) {
    throw new Error(`Invalid arguments for fetch: ${parsedArgs.error.message}`);
    }

    const { url, raw, ignore_images } = parsedArgs.data;

    try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebFetch-MCP/1.0; +https://github.com/modelcontextprotocol)",
      },
    });

    if (!response.ok) {
      return {
        content: [{ type: "text", text: `Error fetching URL: ${response.status} ${response.statusText}` }],
        isError: true,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    
    if (contentType.startsWith("image/")) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return {
        content: [{
          type: "image",
          data: buffer.toString("base64"),
          mimeType: contentType.split(";")[0]
        }]
      };
    }
    
    if (contentType.includes("application/pdf") || contentType.startsWith("audio/") || contentType.startsWith("video/") || (contentType.startsWith("application/") && !contentType.includes("json") && !contentType.includes("xml") && !contentType.includes("javascript"))) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      return {
        content: [{
          type: "resource",
          resource: {
            uri: url,
            mimeType: contentType.split(";")[0],
            blob: buffer.toString("base64")
          }
        }]
      };
    }

    const text = await response.text();

    if (!raw && contentType.includes("text/html")) {
      const currentTurndown = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
      });
      currentTurndown.remove(["script", "style", "noscript"]);
      if (ignore_images) {
        currentTurndown.addRule("ignore-images", {
          filter: "img",
          replacement: () => "",
        });
      }
      const markdown = currentTurndown.turndown(text);
      return {
        content: [{ type: "text", text: markdown }],
      };
    }

    return {
      content: [{ type: "text", text: text }],
    };
    } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
    }
    }

    throw new Error(`Unknown tool: ${name}`);
    });
  return server;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  let transportMode: "stdio" | "sse" = "stdio";
  let port = 3001;
  
  const args = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--transport") {
      transportMode = rawArgs[++i] as "stdio" | "sse";
    } else if (rawArgs[i] === "--port") {
      const portStr = rawArgs[++i];
      if (portStr) port = parseInt(portStr, 10);
    } else {
      const arg = rawArgs[i];
      if (arg) args.push(arg);
    }
  }

  if (args.length === 0) {
    console.error("Warning: No allowed directories provided. All filesystem operations will be denied.");
    console.error("Usage: bun run index.ts [--transport stdio|sse] [--port 3001] <allowed-dir-1> <allowed-dir-2> ...");
  } else {
    // Resolve all provided directory paths to absolute paths
    allowedDirectories = args.map((dir) => path.resolve(dir));
    console.error(`Allowed directories configured:`);
    allowedDirectories.forEach(dir => console.error(` - ${dir}`));
  }

  if (transportMode === "sse") {
    const app = express();
    app.use(cors());
    
    // Map sessionId to transport for each client
    const transports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      if (!sessionId) {
        res.status(500).send("Failed to create session");
        return;
      }
      transports.set(sessionId, transport);
      
      const server = createMcpServer();
      await server.connect(transport);
      
      console.error(`Client connected via SSE (Session: ${sessionId})`);
      
      res.on('close', () => {
        console.error(`Client disconnected (Session: ${sessionId})`);
        transports.delete(sessionId);
      });
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      
      if (!transport) {
        res.status(404).send("Session not found or connection closed");
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.listen(port, () => {
      console.error(`Host MCP server running on SSE at http://localhost:${port}/sse`);
    });
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Host MCP server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
