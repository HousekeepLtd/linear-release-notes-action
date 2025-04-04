import * as core from "@actions/core";
import * as github from "@actions/github";
import { Issue, LinearClient } from "@linear/sdk";

import { extractLastReleaseMessage } from "./utils";

const formatCommentBodyForGoogleChat = (commentBody: string): string => {
  let str = "```\n";
  str += commentBody.replace(/\*\*/g, "*");
  str += "```";
  return str;
};

const issueTypeLabels = ['bug', 'feature', 'chore'];

/**
 * Main function.
 */
async function run(): Promise<void> {
  try {
    const GITHUB_TOKEN = core.getInput("github-token");
    const LINEAR_TOKEN = core.getInput("linear-token");

    if (!github.context.payload.pull_request) {
      throw new Error("No pull request found.");
    }

    const pullRequest = github.context.payload.pull_request;
    const octokit = github.getOctokit(GITHUB_TOKEN);

    const linearClient = new LinearClient({ apiKey: LINEAR_TOKEN });

    const commits: any[] = [];

    /*
     * Attempt to get all commits on the PR. This endpoint will return a maximum of
     * 250 commits, with a 100 per page limit. Loop over pages 1, 2 and 3 to create an
     * array of commits.
     */
    let page = 1;
    for (const max of [0, 100, 200]) {
      /*
       * Early exit. No need to check subsequent pages if we have received less than
       * the maximum number of results.
       */
      if (commits.length < max) {
        break;
      }

      core.info(`Getting commits for PR number ${pullRequest.number} page ${page}...`);
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/commits",
        {
          ...github.context.repo,
          pull_number: pullRequest.number,
          per_page: 100,
          page: page
        }
      );
      core.debug(JSON.stringify(response));
      commits.push(...response.data);
      page++;
    }

    core.info(`Found ${commits.length} commits.`);

    /*
     * From commits, filter down to a list of Linear issue IDs.
     */
    let issueIds = commits
      .map(commit => commit.commit.message)
      .map(message => {
        core.info(`Commit message: ${message}`);
        const matches = message.match(/^\[(HK-[0-9]+)]/);
        return matches ? matches[1] : undefined;
      })
      .filter(ticket => ticket);

    /*
     * De-duplicate the issue IDs.
     */
    issueIds = [...new Set(issueIds)];

    if (issueIds.length === 0) {
      core.info(`No Linear issue IDs detected`);
      return;
    }

    core.info(`Linear issue IDs detected: ${issueIds.join(", ")}`);

    /*
     * Get the data for each Linear issue.
     */
    let issues: Issue[] = [];
    for (const issueId of issueIds) {
      core.info(`Getting data for issue ${issueId}...`);
      try {
        issues.push(await linearClient.issue(issueId));
      } catch (e: any) {
        core.info(`Could not retrieve issue.`);
        core.info(e.message);
        core.error(e, e.stack);
      }
    }

    const commentWarning =
      commits.length === 250
        ? "### Warning: Github API returns a maximum of 250 commits." +
          "Some release notes may be missing.\n\n"
        : "";

    /*
     * Compose the comment.
     */
    let commentBody = "";
    for (const issue of issues) {
      let issueType: string | undefined = undefined;
      for (const issueTypeLabel of issueTypeLabels) {
        if (issue.labelIds.includes(issueTypeLabel)) {
          issueType = issueTypeLabel;
          break;
        }
      }
      const releaseNotes = extractLastReleaseMessage(issue.description);
      const title = issue.title.replace("`", '"').trim();
      commentBody += '**TECH';
      if (issueType) {
        commentBody += ` (${issueType})`;
      }
      commentBody += `: ${title}**\n`;
      if (releaseNotes) {
        commentBody += `${releaseNotes}\n`;
      }
      commentBody += `**Link:** ${issue.url}`;
      commentBody += `\n\n`;
    }

    /*
     * Add the comment to the PR.
     */
    if (commentBody) {
      core.info(`Adding comment to pull request...`);
      await (octokit as any).rest.issues.createComment({
        ...github.context.repo,
        issue_number: pullRequest.number,
        body: commentWarning + formatCommentBodyForGoogleChat(commentBody)
      });
    } else {
      core.info("No comment to add to pull request");
    }
  } catch (error: any) {
    core.setFailed(error);
  }
}

/*
 * Main entry point
 */
run();
