import { Context, Probot } from "probot";
import urllib from "urllib";

export function repoKey(context: Context): string {
  const repo = context.repo();
  return `${repo.owner}/${repo.repo}`;
}

export function isPyTorchOrg(owner: string) : boolean {
  return owner === "pytorch";
}

export function isPyTorchPyTorch(owner: string, repo: string): boolean {
  return isPyTorchOrg(owner) && repo === "pytorch";
}

export class CachedConfigTracker {
  repoConfigs: any = {};

  constructor(app: Probot) {
    app.on("push", async (context) => {
      if (
        context.payload.ref === "refs/heads/master" ||
        context.payload.ref === "refs/heads/main"
      ) {
        await this.loadConfig(context, /* force */ true);
      }
    });
  }

  async loadConfig(context: Context, force = false): Promise<object> {
    const key = repoKey(context);
    if (!(key in this.repoConfigs) || force) {
      context.log({ key }, "loadConfig");
      this.repoConfigs[key] = await context.config("pytorch-probot.yml");
    }
    return this.repoConfigs[key];
  }
}

export class CachedIssueTracker extends CachedConfigTracker {
  repoIssues: any = {};
  configName: string;
  issueParser: (data: string) => object;

  constructor(
    app: Probot,
    configName: string,
    issueParser: (data: string) => object
  ) {
    super(app);
    this.configName = configName;
    this.issueParser = issueParser;

    app.on("issues.edited", async (context) => {
      const config: any = await this.loadConfig(context);
      const issue = context.issue();
      if (config[this.configName] === issue.issue_number) {
        await this.loadIssue(context, /* force */ true);
      }
    });
  }

  async loadIssue(context: Context, force = false): Promise<object> {
    const key = repoKey(context);
    if (!(key in this.repoIssues) || force) {
      context.log({ key }, "loadIssue");
      const config: any = await this.loadConfig(context);
      if (config != null && this.configName in config) {
        const subsPayload = await context.octokit.issues.get(
          context.repo({ issue_number: config[this.configName] })
        );
        const subsText = subsPayload.data["body"];
        context.log({ subsText });
        this.repoIssues[key] = this.issueParser(subsText!);
      } else {
        context.log(
          `${this.configName} is not found in config, initializing with empty string`
        );
        this.repoIssues[key] = this.issueParser("");
      }
      context.log({ parsedIssue: this.repoIssues[key] });
    }
    return this.repoIssues[key];
  }
}

// returns undefined if the request fails
export async function fetchJSON(path: string): Promise<any> {
  const result = await retryRequest(path);
  if (result.res.statusCode !== 200) {
    return;
  }
  return JSON.parse(result.data.toString());
}

export async function retryRequest(
  path: string,
  numRetries: number = 3,
  delay: number = 500
): Promise<urllib.HttpClientResponse<any>> {
  for (let i = 0; i < numRetries; i++) {
    const result = await urllib.request(path);
    if (result.res.statusCode == 200) {
      return result;
    }
    await new Promise((f) => setTimeout(f, delay));
  }
  return await urllib.request(path);
}
