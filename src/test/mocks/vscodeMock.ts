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
