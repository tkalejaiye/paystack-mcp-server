import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod';
import { renderWorkflow, summarizeWorkflows, Workflow } from '../workflows';

export function registerGetPaystackWorkflowTool(server: McpServer, workflows: Workflow[]) {
  server.registerTool(
    'get_paystack_workflow',
    {
      description: `Get a step-by-step workflow for a multi-step Paystack task, such as
    creating an invoice or a dedicated virtual account. Call it without a name to list the
    available workflows, then with a name to get the steps. Available workflows are:
    ${workflows.map((workflow) => workflow.name).join(', ')}`,
      annotations: {
        title: 'Get a Paystack workflow',
        readOnlyHint: true,
        openWorldHint: false,
      },
      inputSchema: {
        name: z.string().optional().describe('Workflow name. Omit to list all workflows'),
      },
    },
    async ({ name }) => {
      if (!name?.trim()) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summarizeWorkflows(workflows), null, 2),
              mimeType: 'application/json',
            },
          ],
        };
      }

      const workflow = workflows.find((candidate) => candidate.name === name.trim());
      if (!workflow) {
        return {
          content: [
            {
              type: 'text',
              text:
                `Workflow "${name}" not found. Available workflows: ` +
                workflows.map((candidate) => candidate.name).join(', '),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text', text: renderWorkflow(workflow), mimeType: 'text/markdown' }],
      };
    },
  );
}
