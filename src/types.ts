export type AgentRecord = {
  id: string;
  displayName: string;
  webhookUrl: string | null;
  apiKeyHash: string;
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};
