export type Block =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "p"; text: string }
  | { type: "li"; text: string };

export type PageLink = { href: string; text: string };

export type PageRead = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  description: string;
  blocked: boolean;
  blockReason: string | null;
  headings: { level: 1 | 2 | 3; text: string }[];
  links: PageLink[];
  blocks: Block[];
  text: string;
  bytes: number;
  ms: number;
  truncated: boolean;
};

export type ReadResult = { ok: true; page: PageRead } | { ok: false; error: string };
