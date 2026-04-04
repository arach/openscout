export interface ScoutWorkflowStep {
  id: string;
  title: string;
  run: () => Promise<void>;
}

export interface ScoutWorkflow {
  id: string;
  title: string;
  steps: ScoutWorkflowStep[];
}

export function defineWorkflow(workflow: ScoutWorkflow): ScoutWorkflow {
  return workflow;
}
