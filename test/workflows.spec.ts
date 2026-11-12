import assert from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PaystackClient } from '../src/paystack-client.js';
import { createServer } from '../src/server.js';
import { resetSkillCache } from '../src/skill-loader.js';
import { renderWorkflow, validateWorkflow, Workflow } from '../src/workflows.js';
import openapiSpec from '../src/generated/paystack-openapi.json';
import bundledWorkflows from '../src/generated/paystack-workflows.json';

const workflows = bundledWorkflows as Workflow[];

const operationIds = new Set<string>();
for (const pathItem of Object.values((openapiSpec as any).paths)) {
  for (const operation of Object.values(pathItem as Record<string, any>)) {
    if (operation?.operationId) operationIds.add(operation.operationId);
  }
}

const SAMPLE: Workflow = {
  file: 'sample-task.md',
  name: 'sample-task',
  title: 'Sample task',
  description: 'A workflow used in tests',
  arguments: [
    { name: 'customer_email', description: 'Email of the customer', required: true },
    { name: 'note', description: 'Optional note' },
  ],
  operations: ['customer_fetch'],
  sensitive: ['bvn'],
  body: '## Steps\n\n1. Call `customer_fetch`.',
};

describe('Workflows', () => {
  describe('bundled workflows', () => {
    it('should include the invoice and dedicated virtual account workflows', () => {
      const names = workflows.map((workflow) => workflow.name);
      assert.ok(names.includes('create-invoice'));
      assert.ok(names.includes('create-dedicated-virtual-account'));
    });

    for (const workflow of workflows) {
      it(`should be a valid workflow: ${workflow.name}`, () => {
        assert.deepStrictEqual(validateWorkflow(workflow, operationIds), []);
      });
    }
  });

  describe('validateWorkflow', () => {
    it('should accept a valid workflow', () => {
      assert.deepStrictEqual(validateWorkflow(SAMPLE, operationIds), []);
    });

    it('should reject operations that are not in the spec', () => {
      const errors = validateWorkflow(
        { ...SAMPLE, operations: ['customer_fetch', 'invoice_teleport'] },
        operationIds,
      );
      assert.ok(errors.some((error) => error.includes('"invoice_teleport" is not in the OpenAPI')));
    });

    it('should reject listed operations the steps never use', () => {
      const errors = validateWorkflow(
        { ...SAMPLE, operations: ['customer_fetch', 'customer_create'] },
        operationIds,
      );
      assert.ok(errors.some((error) => error.includes('"customer_create" is listed but never')));
    });

    it('should reject bad names, missing fields and sensitive prompt arguments', () => {
      const errors = validateWorkflow(
        {
          ...SAMPLE,
          name: 'Sample_Task',
          description: '',
          arguments: [{ name: 'bvn', description: 'BVN' }],
        },
        operationIds,
      );
      assert.ok(errors.some((error) => error.includes('kebab-case')));
      assert.ok(errors.some((error) => error.includes('file name must match')));
      assert.ok(errors.some((error) => error.includes('"description" is required')));
      assert.ok(errors.some((error) => error.includes('"bvn" must not be a prompt argument')));
    });
  });

  describe('renderWorkflow', () => {
    it('should fill in provided inputs and flag missing required ones', () => {
      const text = renderWorkflow(SAMPLE, { customer_email: 'ada@example.com' });
      assert.ok(text.startsWith('# Workflow: Sample task'));
      assert.ok(text.includes('- customer_email: `ada@example.com`'));
      assert.ok(text.includes('- note: not provided (optional)'));

      const missing = renderWorkflow(SAMPLE);
      assert.ok(missing.includes('- customer_email: not provided yet, ask the user'));
    });

    it('should add sensitive-data handling and the operations to look up', () => {
      const text = renderWorkflow(SAMPLE);
      assert.ok(text.includes('## Handling sensitive details'));
      assert.ok(text.includes('Sensitive inputs: bvn.'));
      assert.ok(text.includes('## Operations used\n`customer_fetch`'));
      assert.ok(!renderWorkflow({ ...SAMPLE, sensitive: [] }).includes('sensitive details'));
    });
  });

  describe('over MCP', () => {
    let client: Client;
    const originalFetch = global.fetch;

    before(async () => {
      // Use the bundled skill instead of fetching it from GitHub
      resetSkillCache();
      global.fetch = async () => {
        throw new Error('offline');
      };
      const server = await createServer(
        new PaystackClient('sk_test_1234567890abcdef1234567890abcdef12345678'),
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(clientTransport);
    });

    after(async () => {
      global.fetch = originalFetch;
      resetSkillCache();
      await client.close();
    });

    it('should list workflows from get_paystack_workflow', async () => {
      const result: any = await client.callTool({ name: 'get_paystack_workflow', arguments: {} });
      const listed = JSON.parse(result.content[0].text);
      assert.deepStrictEqual(
        listed.map((workflow: any) => workflow.name),
        workflows.map((workflow) => workflow.name),
      );
      assert.strictEqual(listed[0].uri, `paystack://workflows/${listed[0].name}`);
    });

    it('should return one workflow by name, or an error listing the options', async () => {
      const found: any = await client.callTool({
        name: 'get_paystack_workflow',
        arguments: { name: 'create-invoice' },
      });
      assert.ok(!found.isError);
      assert.ok(found.content[0].text.includes('# Workflow: Create and send an invoice'));

      const missing: any = await client.callTool({
        name: 'get_paystack_workflow',
        arguments: { name: 'nope' },
      });
      assert.strictEqual(missing.isError, true);
      assert.ok(missing.content[0].text.includes('create-invoice'));
    });

    it('should expose each workflow as a prompt with optional arguments', async () => {
      const { prompts } = await client.listPrompts();
      const invoice = prompts.find((prompt) => prompt.name === 'create-invoice')!;
      assert.strictEqual(invoice.title, 'Create and send an invoice');
      assert.ok(invoice.arguments!.some((argument) => argument.name === 'customer_email'));
      assert.ok(invoice.arguments!.every((argument) => !argument.required));

      const prompt = await client.getPrompt({
        name: 'create-invoice',
        arguments: { customer_email: 'ada@example.com', amount: '1500.50' },
      });
      const text = (prompt.messages[0].content as any).text;
      assert.ok(text.includes('- customer_email: `ada@example.com`'));
      assert.ok(text.includes('- amount: `1500.50`'));
      assert.ok(text.endsWith('Follow this workflow now.'));
    });

    it('should list and read workflows as resources', async () => {
      const { resources } = await client.listResources();
      const uris = resources.map((resource) => resource.uri);
      assert.ok(uris.includes('paystack://workflows/create-dedicated-virtual-account'));

      const { contents } = await client.readResource({
        uri: 'paystack://workflows/create-dedicated-virtual-account',
      });
      assert.ok((contents[0] as any).text.includes('Sensitive inputs: bvn, account_number.'));
    });
  });
});
