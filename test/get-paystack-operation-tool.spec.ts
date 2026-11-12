import assert from 'node:assert';
import { OpenAPIV3 } from 'openapi-types';
import { OpenAPIParser } from '../src/openapi-parser.js';
import { registerGetPaystackOperationTool } from '../src/tools/get-paystack-operation.js';
import openapiSpec from '../src/generated/paystack-openapi.json';

describe('GetPaystackOperationTool', () => {
  const openapi = new OpenAPIParser(openapiSpec as unknown as OpenAPIV3.Document);
  let toolHandler: any;

  before(() => {
    openapi.parse();
    const server = {
      registerTool: (_name: string, _config: any, handler: any) => {
        toolHandler = handler;
      },
    } as any;
    registerGetPaystackOperationTool(server, openapi);
  });

  async function details(operationId: string) {
    const result = await toolHandler({ operation_id: operationId });
    assert.ok(!result.isError);
    return JSON.parse(result.content[0].text);
  }

  describe('field names', () => {
    it('should resolve request body fields through $refs', () => {
      const names = openapi.getOperationFieldNames('transfer_initiate');
      assert.ok(names.includes('amount'));
      assert.ok(names.includes('recipient'));
    });

    it('should include query and path parameters', () => {
      assert.ok(openapi.getOperationFieldNames('transaction_list').includes('per_page'));
      assert.ok(openapi.getOperationFieldNames('paymentRequest_verify').includes('id'));
    });

    it('should return no fields for an unknown operation', () => {
      assert.deepStrictEqual(openapi.getOperationFieldNames('does_not_exist'), []);
    });
  });

  describe('amount notes', () => {
    for (const operationId of [
      'paymentRequest_create',
      'transaction_initialize',
      'transfer_initiate',
      'refund_create',
    ]) {
      it(`should explain amount units for ${operationId}`, async () => {
        const { notes } = await details(operationId);
        assert.ok(notes.some((note: string) => note.includes('smallest currency unit')));
        assert.ok(notes.some((note: string) => note.includes('150050')));
      });
    }

    it('should not add notes to operations without amounts', async () => {
      const operation = await details('customer_create');
      assert.strictEqual(operation.notes, undefined);
      assert.strictEqual(operation.path, '/customer');
    });
  });
});
