// JSON contract returned by GET /results/:deployId. Keep browser code independent of server modules.
export interface Results {
    deployId: string;
    complete: boolean;
    lineCount?: number;
    currentCommand?: string;
    isByoo?: boolean;
    expirationDate?: string;
    mainUser?: { username?: string; password?: string; loginUrl?: string; permalink?: string };
    errors?: { command: string; error: string; raw?: unknown }[];
    commandResults?: { command: string; summary?: string; shortForm?: string; raw?: unknown }[];
    herokuResults?: { appName: string; openUrl: string; dashboardUrl: string }[];
}
