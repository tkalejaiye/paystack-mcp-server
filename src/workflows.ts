/**
 * Workflows are step-by-step recipes for multi-step Paystack tasks, written as
 * markdown in src/data/workflows and bundled at build time. They add capabilities
 * as content rather than code: the steps run through the generic tools, and each
 * workflow is exposed as a prompt, a resource and via the get_paystack_workflow tool.
 */

export interface WorkflowArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface Workflow {
  /** Source file name, e.g. create-invoice.md */
  file: string;
  name: string;
  title: string;
  description: string;
  arguments?: WorkflowArgument[];
  /** Operation IDs the steps use */
  operations: string[];
  /** Inputs that are personal or financial data (e.g. BVN) */
  sensitive?: string[];
  /** Webhook events the workflow waits for; it polls when events can't be received */
  events?: string[];
  body: string;
}

export const WORKFLOW_URI_PREFIX = 'paystack://workflows/';

const SENSITIVE_HANDLING = `## Handling sensitive details
This workflow needs personal or financial details. Ask for them only when the step that
needs them is reached, send them only to the operation that requires them, and never
repeat them back in full: mask all but the last 4 characters in summaries.`;

/** Problems with a workflow definition, checked in tests so CI catches spec drift. */
export function validateWorkflow(workflow: Workflow, operationIds: Set<string>): string[] {
  const errors: string[] = [];
  const where = workflow.file ?? workflow.name;

  for (const field of ['name', 'title', 'description', 'body'] as const) {
    if (typeof workflow[field] !== 'string' || !workflow[field].trim()) {
      errors.push(`${where}: "${field}" is required`);
    }
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(workflow.name ?? '')) {
    errors.push(`${where}: name must be kebab-case`);
  }
  if (workflow.file && workflow.file !== `${workflow.name}.md`) {
    errors.push(`${where}: file name must match the workflow name`);
  }

  if (!Array.isArray(workflow.operations) || workflow.operations.length === 0) {
    errors.push(`${where}: list the operation IDs the workflow uses in "operations"`);
  }
  for (const operationId of workflow.operations ?? []) {
    if (!operationIds.has(operationId)) {
      errors.push(`${where}: operation "${operationId}" is not in the OpenAPI spec`);
    } else if (!workflow.body?.includes(operationId)) {
      errors.push(`${where}: operation "${operationId}" is listed but never used in the steps`);
    }
  }

  const argumentNames = (workflow.arguments ?? []).map((argument) => argument.name);
  for (const name of argumentNames) {
    if (!/^[a-z][a-z0-9_]*$/.test(name ?? '')) {
      errors.push(`${where}: argument "${name}" must be snake_case`);
    }
  }
  if (new Set(argumentNames).size !== argumentNames.length) {
    errors.push(`${where}: argument names must be unique`);
  }
  for (const name of workflow.sensitive ?? []) {
    if (argumentNames.includes(name)) {
      errors.push(`${where}: sensitive input "${name}" must not be a prompt argument`);
    }
  }

  return errors;
}

/** One-line summaries, for listing workflows. */
export function summarizeWorkflows(workflows: Workflow[]) {
  return workflows.map(({ name, title, description, arguments: args }) => ({
    name,
    title,
    description,
    uri: `${WORKFLOW_URI_PREFIX}${name}`,
    arguments: (args ?? []).map((argument) => argument.name),
  }));
}

/** The workflow as instructions for the model, with any provided inputs filled in. */
export function renderWorkflow(
  workflow: Workflow,
  values: Record<string, string | undefined> = {},
): string {
  const sections = [`# Workflow: ${workflow.title}`, workflow.description];

  const args = workflow.arguments ?? [];
  if (args.length > 0) {
    const lines = args.map((argument) => {
      const value = values[argument.name]?.trim();
      const status = value
        ? `\`${value}\``
        : argument.required
          ? 'not provided yet, ask the user'
          : 'not provided (optional)';
      return `- ${argument.name}: ${status}. ${argument.description}`;
    });
    sections.push(`## Inputs\n${lines.join('\n')}`);
  }

  sections.push(workflow.body);

  if (workflow.sensitive?.length) {
    sections.push(`${SENSITIVE_HANDLING}\nSensitive inputs: ${workflow.sensitive.join(', ')}.`);
  }

  sections.push(
    `## Operations used\n${workflow.operations.map((id) => `\`${id}\``).join(', ')}. ` +
      'Call "get_paystack_operation" for each one before using it.',
  );

  return sections.join('\n\n');
}
