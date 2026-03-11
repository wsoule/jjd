import { logger } from "./util/logger";

export interface LinearIssue {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  description?: string;
  state: string;
  url: string;
}

/**
 * Fetches issue details from Linear's GraphQL API.
 * Requires LINEAR_API_KEY env var.
 *
 * When running inside Claude Code, the Linear MCP tools handle this instead.
 * This module is for standalone CLI use.
 */
export class LinearClient {
  private apiKey: string;
  private endpoint = "https://api.linear.app/graphql";

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.LINEAR_API_KEY ?? "";
    if (!this.apiKey) {
      logger.warn("No LINEAR_API_KEY set — Linear integration disabled");
    }
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Fetch an issue by its identifier (e.g. "ENG-123"). */
  async getIssue(identifier: string): Promise<LinearIssue | null> {
    if (!this.isConfigured) return null;

    const query = `
      query IssueByIdentifier($id: String!) {
        issueSearch(filter: { identifier: { eq: $id } }, first: 1) {
          nodes {
            id
            identifier
            title
            description
            state { name }
            url
          }
        }
      }
    `;

    try {
      const resp = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query, variables: { id: identifier } }),
      });

      const data = (await resp.json()) as any;
      const node = data?.data?.issueSearch?.nodes?.[0];
      if (!node) return null;

      return {
        id: node.id,
        identifier: node.identifier,
        title: node.title,
        description: node.description ?? undefined,
        state: node.state?.name ?? "Unknown",
        url: node.url,
      };
    } catch (err) {
      logger.error(`Linear API error: ${err}`);
      return null;
    }
  }
}
