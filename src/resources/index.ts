import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OpenAPIParser } from '../openapi-parser';
import { registerOperationListResource } from './paystack-operation-list';
import { registerSkillResource } from './paystack-skill';
import { registerWorkflowResources } from './paystack-workflows';
import { Workflow } from '../workflows';

export function registerAllResources(
  server: McpServer,
  openapi: OpenAPIParser,
  skillContent: string,
  workflows: Workflow[] = [],
) {
  registerOperationListResource(server, openapi);
  registerSkillResource(server, skillContent);
  registerWorkflowResources(server, workflows);
}
