import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { renderWorkflow, Workflow } from '../workflows';

/**
 * Each workflow is also a prompt, so users can start one directly from their client
 * (e.g. a slash command) and fill in the inputs they already know.
 */
export function registerAllPrompts(server: McpServer, workflows: Workflow[]) {
  for (const workflow of workflows) {
    // Prompt arguments are optional: anything missing is asked for during the workflow
    const argsSchema = Object.fromEntries(
      (workflow.arguments ?? []).map((argument) => [
        argument.name,
        z.string().optional().describe(argument.description),
      ]),
    );

    server.registerPrompt(
      workflow.name,
      { title: workflow.title, description: workflow.description, argsSchema },
      (values) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `${renderWorkflow(workflow, values)}\n\nFollow this workflow now.`,
            },
          },
        ],
      }),
    );
  }
}
