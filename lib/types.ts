export type Connector = {
  id: string;
  name: string;
  url: string;
  headerName?: string; // default "Authorization"
  token?: string;
  enabled: boolean;
};
