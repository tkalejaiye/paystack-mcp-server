import assert from 'node:assert';
import { OpenAPIV3 } from 'openapi-types';
import { OpenAPIParser } from '../src/openapi-parser.js';
import openapiSpec from '../src/generated/paystack-openapi.json';

describe('OpenAPI parsing', () => {
  const openapi = new OpenAPIParser(openapiSpec as unknown as OpenAPIV3.Document);

  before(() => {
    openapi.parse();
  });

  describe('Get operation by ID', () => {
    it('should return operation name given the operation ID', () => {
      const op = openapi.getOperationById('transaction_partialDebit');
      assert.equal('Partial Debit', op?.name);
    });
  });
});
