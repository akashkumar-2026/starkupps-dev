export type TrpcContext = {
  // aud is the verified JWT audience (admin | pos | undefined for legacy
  // tokens). Backend-derived only — never accept client-provided role/aud.
  aud: "admin" | "pos" | null;
  user: {
    id: number;
    openId: string;
    name: string | null;
    email: string | null;
    loginMethod: string | null;
    role: "user" | "admin";
    createdAt: Date;
    updatedAt: Date;
    lastSignedIn: Date;
  } | null;
  req: {
    protocol: string;
    headers: Record<string, string | undefined>;
    url?: string;
    cookies?: Record<string, string>;
  };
  res: {
    clearCookie: (name: string, options: Record<string, unknown>) => void;
    cookie?: (
      name: string,
      value: string,
      options: Record<string, unknown>
    ) => void;
  };
};
