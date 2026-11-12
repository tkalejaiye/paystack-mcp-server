import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { renderWorkflow, Workflow, WORKFLOW_URI_PREFIX } from '../workflows';

export function registerWorkflowResources(server: McpServer, workflows: Workflow[]) {
  server.registerResource(
    'paystack_workflow',
    new ResourceTemplate(`${WORKFLOW_URI_PREFIX}{name}`, {
      list: async () => ({
        resources: workflows.map((workflow) => ({
          uri: `${WORKFLOW_URI_PREFIX}${workflow.name}`,
          name: workflow.name,
          title: workflow.title,
          description: workflow.description,
          mimeType: 'text/markdown',
        })),
      }),
      complete: {
        name: (value) =>
          workflows.map((workflow) => workflow.name).filter((name) => name.startsWith(value)),
      },
    }),
    {
      title: 'Paystack workflow',
      description: 'Step-by-step workflows for multi-step Paystack tasks',
      mimeType: 'text/markdown',
    },
    async (uri, { name }) => {
      const workflow = workflows.find((candidate) => candidate.name === name);
      if (!workflow) {
        throw new Error(`Workflow "${name}" not found`);
      }
      return {
        contents: [{ uri: uri.href, text: renderWorkflow(workflow), mimeType: 'text/markdown' }],
      };
    },
  );
}
