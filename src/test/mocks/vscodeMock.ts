export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(start: Position | number, end: Position | number, endLine?: number, endChar?: number) {
    if (typeof start === 'number') {
      this.start = new Position(start, end as number);
      this.end = new Position(endLine!, endChar!);
    } else {
      this.start = start as Position;
      this.end = end as Position;
    }
  }
}

export class Uri {
  constructor(public readonly scheme: string, public readonly path: string, public readonly query: string = '') {}

  public static parse(val: string): Uri {
    const [schemePart, rest] = val.split('://');
    return new Uri(schemePart || 'file', rest || val);
  }

  public static from(components: { scheme: string; path: string; query?: string }): Uri {
    return new Uri(components.scheme, components.path, components.query || '');
  }

  public static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }

  public get fsPath(): string {
    return this.path;
  }

  public toString(): string {
    return `${this.scheme}://${this.path}`;
  }
}

export class WorkspaceEdit {
  public replacements: { uri: Uri; range: Range; newText: string }[] = [];
  public deletions: { uri: Uri; range: Range }[] = [];
  public insertions: { uri: Uri; position: Position; text: string }[] = [];

  public replace(uri: Uri, range: Range, newText: string): void {
    this.replacements.push({ uri, range, newText });
  }

  public delete(uri: Uri, range: Range): void {
    this.deletions.push({ uri, range });
  }

  public insert(uri: Uri, position: Position, text: string): void {
    this.insertions.push({ uri, position, text });
  }
}

export class TreeItem {
  constructor(public label?: string, public collapsibleState?: any) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2
}

export class ThemeIcon {
  constructor(public readonly id: string, public readonly color?: any) {}
  public static File = new ThemeIcon('file');
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}


export class CodeLens {
  constructor(
    public readonly range: Range,
    public readonly command?: {
      title: string;
      command: string;
      tooltip?: string;
      arguments?: any[];
    }
  ) {}
}

export class EventEmitter<T = any> {
  private listeners: ((e: T) => any)[] = [];
  public event = (listener: (e: T) => any) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  public fire(data: T): void {
    this.listeners.forEach((l) => l(data));
  }
  public dispose(): void {
    this.listeners = [];
  }
}

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: (key: string, defaultValue?: any) => defaultValue,
    update: async () => {}
  }),
  textDocuments: [],
  applyEdit: async () => true
};

export const window = {
  activeTextEditor: undefined as any,
  showInformationMessage: async () => {},
  showWarningMessage: async () => {},
  showErrorMessage: async () => {}
};

export const commands = {
  executeCommand: async () => {}
};
