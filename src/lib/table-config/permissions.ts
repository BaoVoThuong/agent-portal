export function canExportImport(input: {
  isManager: boolean;
  isWorker: boolean;
  isAssistant: boolean;
}): boolean {
  if (input.isManager) return true;
  return input.isWorker && !input.isAssistant;
}
