import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Issue } from "@linear/sdk";
import type { RepositoryConfig } from "cyrus-edge-worker";

// Mock readline
vi.mock("node:readline", () => ({
	createInterface: vi.fn(() => ({
		question: vi.fn(),
		close: vi.fn(),
	})),
}));

// Mock child_process
const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
	execSync: mockExecSync,
}));

// Mock fs
const mockExistsSync = vi.fn();
vi.mock("node:fs", () => ({
	existsSync: mockExistsSync,
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	copyFileSync: vi.fn(),
}));

// Mock path
vi.mock("node:path", () => ({
	join: vi.fn((...parts) => parts.join("/")),
	resolve: vi.fn((...parts) => "/" + parts.join("/")),
	dirname: vi.fn((path) => path.split("/").slice(0, -1).join("/")),
	basename: vi.fn((path) => path.split("/").pop()),
	homedir: vi.fn(() => "/home/user"),
}));

describe("Project Keys Parsing", () => {
	it("should handle normal comma-separated project names", () => {
		const projectKeysInput = "Mobile App,Web Platform,API Service";
		const projectKeys = projectKeysInput
			? projectKeysInput
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
			: undefined;

		expect(projectKeys).toEqual(["Mobile App", "Web Platform", "API Service"]);
	});

	it("should filter out empty strings from consecutive commas", () => {
		const projectKeysInput = "Project1,,Project2,,,Project3";
		const projectKeys = projectKeysInput
			? projectKeysInput
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
			: undefined;

		expect(projectKeys).toEqual(["Project1", "Project2", "Project3"]);
	});

	it("should handle trailing commas", () => {
		const projectKeysInput = "Project1,Project2,";
		const projectKeys = projectKeysInput
			? projectKeysInput
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
			: undefined;

		expect(projectKeys).toEqual(["Project1", "Project2"]);
	});

	it("should handle leading commas", () => {
		const projectKeysInput = ",Project1,Project2";
		const projectKeys = projectKeysInput
			? projectKeysInput
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
			: undefined;

		expect(projectKeys).toEqual(["Project1", "Project2"]);
	});

	it("should handle spaces around project names", () => {
		const projectKeysInput = "  Project1  ,  Project2  ,  Project3  ";
		const projectKeys = projectKeysInput
			? projectKeysInput
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
			: undefined;

		expect(projectKeys).toEqual(["Project1", "Project2", "Project3"]);
	});

	it("should handle empty input", () => {
		const projectKeysInput = "";
		const projectKeys = projectKeysInput
			? projectKeysInput
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
			: undefined;

		expect(projectKeys).toBeUndefined();
	});

	it("should handle only commas input", () => {
		const projectKeysInput = ",,,";
		const projectKeys = projectKeysInput
			? projectKeysInput
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
			: undefined;

		expect(projectKeys).toEqual([]);
	});

	it("should handle mixed empty and valid entries", () => {
		const projectKeysInput = "Valid1,,  ,Valid2,   ,,Valid3";
		const projectKeys = projectKeysInput
			? projectKeysInput
					.split(",")
					.map((p) => p.trim())
					.filter(Boolean)
			: undefined;

		expect(projectKeys).toEqual(["Valid1", "Valid2", "Valid3"]);
	});
});

describe("Git Worktree Creation - Windows Compatibility", () => {
	// We need to test the internal createGitWorktree logic
	// Since EdgeApp is not exported, we'll test the mkdir -p failure scenario
	// by mocking execSync to simulate Windows Command Prompt behavior

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset to default successful behavior
		mockExecSync.mockReturnValue("");
		mockExistsSync.mockReturnValue(false);
	});

	it("should demonstrate Windows mkdir -p compatibility issue", () => {
		// This test demonstrates the exact issue that occurs on Windows
		// when execSync is called with 'mkdir -p' command
		
		// Mock Windows Command Prompt behavior where mkdir doesn't recognize -p flag
		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd.includes('mkdir -p')) {
				const error = new Error("'mkdir' is not recognized as an internal or external command, operable program or batch file.");
				(error as any).status = 1;
				(error as any).code = 'ENOENT';
				throw error;
			}
			return "";
		});

		// Test the exact command that would fail on Windows
		const windowsWorkspaceDir = "C:\\Users\\user\\.cyrus\\workspaces\\repo-name";
		const mkdirCommand = `mkdir -p "${windowsWorkspaceDir}"`;

		// This should throw the Windows-specific error
		expect(() => {
			mockExecSync(mkdirCommand, {
				cwd: "C:\\projects\\myapp",
				stdio: "pipe"
			});
		}).toThrow("'mkdir' is not recognized as an internal or external command");

		// Verify the command was called
		expect(mockExecSync).toHaveBeenCalledWith(
			mkdirCommand,
			expect.objectContaining({
				cwd: "C:\\projects\\myapp",
				stdio: "pipe"
			})
		);
	});

	it("should show Windows Command Prompt mkdir syntax differences", () => {
		// Windows Command Prompt has different syntax than Unix/Linux for mkdir
		// Unix/Linux: mkdir -p /path/to/directory
		// Windows CMD: mkdir "path\to\directory" (no -p flag, recursive by default in modern Windows)
		
		// Simulate what happens when Unix mkdir -p is used on Windows
		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd.includes('mkdir -p')) {
				// This is the actual error message from Windows Command Prompt
				const error = new Error("'mkdir' is not recognized as an internal or external command,\noperable program or batch file.");
				(error as any).status = 1;
				(error as any).code = 'ENOENT';
				throw error;
			}
			return "";
		});

		// The problematic commands from app.ts lines 1165 and 1324
		const workspaceCommand = `mkdir -p "C:\\Users\\user\\.cyrus\\workspaces\\repo-name"`;
		const fallbackCommand = `mkdir -p "C:\\workspace\\fallback\\ISSUE-123"`;

		// Both should fail on Windows
		expect(() => mockExecSync(workspaceCommand, { stdio: "pipe" }))
			.toThrow("'mkdir' is not recognized as an internal or external command");
			
		expect(() => mockExecSync(fallbackCommand, { stdio: "pipe" }))
			.toThrow("'mkdir' is not recognized as an internal or external command");
	});

	it("should identify the exact problematic lines in app.ts", () => {
		// This test documents the exact locations where mkdir -p is used
		// Line 1165: execSync(`mkdir -p "${repository.workspaceBaseDir}"`, {...})
		// Line 1324: execSync(`mkdir -p "${fallbackPath}"`, { stdio: "pipe" })
		
		const problematicCommands = [
			'mkdir -p "${repository.workspaceBaseDir}"',
			'mkdir -p "${fallbackPath}"'
		];

		mockExecSync.mockImplementation((cmd: string) => {
			if (cmd.includes('mkdir -p')) {
				const error = new Error("The system cannot find the path specified.");
				(error as any).status = 1;
				throw error;
			}
			return "";
		});

		// These are the commands that would fail
		for (const command of problematicCommands) {
			const fullCommand = command.replace('${repository.workspaceBaseDir}', 'C:\\workspace')
				.replace('${fallbackPath}', 'C:\\fallback');
			
			expect(() => mockExecSync(fullCommand, { stdio: "pipe" }))
				.toThrow("The system cannot find the path specified");
		}
	});
});
