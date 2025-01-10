#!/usr/bin/env node

import chalk from "chalk";
import { execSync } from "child_process";
import { program } from "commander";
import dotenv, { DotenvParseOutput } from "dotenv";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import inquirer from "inquirer";
import OpenAI from "openai";
import path from "path";

const home = process.env.HOME || process.env.USERPROFILE;
if (!home) {
  throw new Error("HOME or USERPROFILE environment variable is not set.");
}
const configPath = path.join(home, ".cai");
dotenv.config({ path: configPath });

/**
 * 读取 ~/.cai 文件中的环境变量
 */
async function readEnvFile() {
  try {
    if (!existsSync(configPath)) {
      await writeFile(configPath, "");
      return {} as DotenvParseOutput;
    }
    // 读取文件内容
    const fileContent = await readFile(configPath, "utf-8");
    // 使用 dotenv 解析文件内容
    const envConfig = dotenv.parse(fileContent);
    return envConfig;
  } catch (error) {
    throw error;
  }
}

program
  .version("0.1.0")
  .description(
    "A tool to generate Git commit messages using OpenAI based on staged changes."
  );

program
  .command("config")
  .arguments("[key] [value]")
  .option("--list", "List all config items")
  .action(async (key, value, options) => {
    const content = await readEnvFile();
    if (key && value) {
      content[key] = value;
      const newContent = Object.entries(content)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      await writeFile(configPath, newContent, "utf-8");
      console.log(chalk.green(`${key}=${value}`));
    }
    if (options.list) {
      console.log(content);
    }
  });

interface ProgramOptions {
  dryRun?: boolean;
}

const options = program.opts() as ProgramOptions;

function getStagedDiff(): string {
  try {
    const diff = execSync("git diff --cached").toString();
    if (!diff) {
      console.log(chalk.yellow("No changes staged for commit."));
      process.exit(0);
    }
    return diff;
  } catch (error) {
    console.error(chalk.red("Failed to get staged diff."));
    process.exit(1);
  }
}

async function generateCommitMessage(diff: string): Promise<string[]> {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });

    console.log(chalk.blue("Generating commit message..."));
    const response = await openai.chat.completions.create({
      model: process.env.MODEL_NAME || "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are an experienced developer responsible for generating commit messages that comply with the Angular Commit Message Conventions based on code changes.`,
        },
        {
          role: "user",
          content: `### Angular Commit Message Conventions
          1. The commit message must include the following parts:
            - **Type**: Must be one of the following:
              - feat: A new feature
              - fix: A bug fix
              - docs: Documentation changes
              - style: Code style changes (do not affect logic)
              - refactor: Code refactoring (neither fixes a bug nor adds a feature)
              - perf: Performance improvements
              - test: Test-related changes
              - chore: Build or tooling changes
            - **Scope (optional)**: Describes the module or component being modified.
            - **Subject**: A concise description of the changes, written in the present tense, starting with a lowercase letter, and without a period at the end.

          2. Commit message format:
            \`\`\`
            <type>(<scope>): <subject>
            \`\`\`

          ### Examples
          1. feat(user): add login functionality
          2. fix(auth): resolve token expiration issue
          3. refactor(api): simplify request handling logic
          4. style(ui): format button component
          5. chore: update dependencies

          ### Task
          Based on the following code changes, generate **1-3 commit messages** that comply with the Angular Commit Message Conventions. Each commit message should be separated by a newline character. **Please avoid using scope unless absolutely necessary. ** 
          **Ensure the subject starts with a lowercase letter**:
          \`\`\`diff
          ${diff}
          \`\`\`
          Please strictly follow the Angular Commit Message Conventions, ensuring the type, scope (if applicable), and subject are all compliant.`,
        },
      ],
    });

    let commitMessages = (response.choices[0].message.content ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("```"));
    return commitMessages;
  } catch (error) {
    console.error(chalk.red("Failed to generate commit message using OpenAI."));
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function selectCommitMessage(messages: string[]): Promise<string> {
  const { selectedMessage } = await inquirer.prompt([
    {
      type: "list",
      name: "selectedMessage",
      message: "Select a commit message:",
      choices: messages,
    },
  ]);

  return selectedMessage;
}

function commitChanges(message: string): void {
  try {
    execSync(`git commit -m "${message}"`, { stdio: "inherit" });
  } catch (error) {
    console.error(chalk.red("Failed to commit changes."));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY || !process.env.MODEL_NAME) {
    console.error(
      chalk.red(
        "Invalid config file. Please ensure OPENAI_API_KEY and MODEL_NAME are set in ~/.cai."
      )
    );
    process.exit(1);
  }
  const diff = getStagedDiff();
  const commitMessages = await generateCommitMessage(diff);

  console.log(chalk.green("Generated commit message:"));
  commitMessages.forEach((msg, index) => {
    console.log(chalk.blue(`${index + 1}. ${msg}`));
  });

  const selectedMessage = await selectCommitMessage(commitMessages);

  console.log(chalk.green("Selected commit message:"));
  console.log(chalk.blue(selectedMessage));

  if (!options.dryRun) {
    commitChanges(selectedMessage);
  } else {
    console.log(chalk.yellow("Dry run mode: Commit message was not applied."));
  }
}

program.command("commit").action(main);

program.parse(process.argv);
