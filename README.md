# README

This is a GitHub Action that should be set up to run upon any pull request into master.

Inputs:
- `github-token`: A GitHub token
- `linear-token`: A Linear API token

When the workflow runs, it uses the Linear API to fetch the last "release message" from the description of
every story referenced in the commit messages. Each release message is annotated with the story title and link, and the
concatenated release messages are formatted ready to be copied-and-pasted into Google Chat.
