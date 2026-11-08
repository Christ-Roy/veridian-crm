import { WorkflowActionType } from 'twenty-shared/workflow';

// Twenty's own default: client code only runs when LOGIC_FUNCTION_TYPE says so, never in production by default.
const isClientCodeExecutionDisabled = (): boolean =>
  (
    process.env.LOGIC_FUNCTION_TYPE ??
    (process.env.NODE_ENV === 'development' ? 'LOCAL' : 'DISABLED')
  ).toUpperCase() === 'DISABLED';

// A step that cannot run is refused when it is built, instead of failing silently at run time.
export const isWorkflowActionDisabledByVeridian = (
  type: WorkflowActionType | string,
): boolean => {
  if (
    type === WorkflowActionType.CODE ||
    type === WorkflowActionType.LOGIC_FUNCTION
  ) {
    return isClientCodeExecutionDisabled();
  }

  if (
    type === WorkflowActionType.AI_AGENT ||
    type === WorkflowActionType.CLASSIFY
  ) {
    return process.env.VERIDIAN_AI_DISABLED === 'true';
  }

  return false;
};
