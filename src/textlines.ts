import { debug } from "things"
import { addHash, int, nat, startHash, string } from "things"
import { Relation, mkOrderAndHash } from "things"
import { freeze } from "things"
import { Lexer } from "./lexer.js"
import { Span, Spanned } from "./span.js"

/** Some sort of normalized character representation. */
export type TextChar = string 

export interface Text extends Iterable<TextChar>{
    count : nat
    charAt(index : nat) : TextChar
    slice(startIndexInclusive : nat, endIndexExclusive? : nat) : Text
    toString() : string
}

function compareText(x : Text, y : Text) : Relation {
    let c = int.compare(x.count, y.count);
    if (c !== Relation.EQUAL) return c;
    const count = x.count;
    for (let i = 0; i < count; i++) {
        c = string.compare(x.charAt(i), y.charAt(i));
        if (c !== Relation.EQUAL) return c;
    }
    return Relation.EQUAL;
}

const TEXT_HASH = string.hash("Text");
function hashText(x : Text) : int {
    let h = startHash(TEXT_HASH);
    for (const c of x) {
        h = addHash(h, string.hash(c));
    }
    return h;
}

export const Text = mkOrderAndHash("text", 
    x => typeof x === "string", compareText, hashText);

export interface TextLines {
    lineCount : nat
    lineAt(line : nat) : Text
    valid(line : nat, column : nat) : boolean
    assert(line : nat, column : nat) : void
    absolute(line: nat, index : nat) : [nat, nat]
}

export function absoluteSpan(lines : TextLines, span : Span) : Span {
    const [l1, o1] = lines.absolute(span.startLine, span.startColumnInclusive);
    const [l2, o2] = lines.absolute(span.endLine, span.endColumnExclusive);
    return new Span(l1, o1, l2, o2);
}

function visibleSpaces(text : Text) : string {
    let result = "";
    for (const c of text) {
        if (c === " ") result += "⋅"; else result += c;
    }
    return result;
}

export function printTextLines(lines : TextLines, println : (text : string) => void = debug) {
    const maxLinePlaces = ("" + lines.lineCount).length;
    for (let i = 0; i < lines.lineCount; i++) {
        let n = "" + i;
        while (n.length < maxLinePlaces) n = "0" + n;
        println(n + "  " + visibleSpaces(lines.lineAt(i)));
    }
}

export function textOf(text : string | Text) : Text {
    if (string.is(text)) {
        const chars = [...text.normalize("NFC")];
        return new TextSlice(0, chars.length, chars);
    } else return text;
}

export function textOfChars(chars : TextChar[]) : Text {
    return new TextSlice(0, chars.length, chars);
}

class TextSlice implements Text {
    startIndex : nat
    count : nat
    chars : TextChar[]
    constructor (startIndex : nat, count : nat, chars : TextChar[]) {
        this.startIndex = startIndex;
        this.count = count;
        this.chars = chars;
        freeze(this);
    }
    [Symbol.iterator](): Iterator<TextChar> {
        const chars = this.chars;
        let index = this.startIndex;
        let endIndex = this.startIndex + this.count;
        function *it() {
            while (index < endIndex) {
                yield chars[index];
                index++;
            }
        }
        return it();
    }
    charAt(index : nat) : TextChar {
        if (index < 0 || index >= this.count) 
            throw new Error(`Out of bounds index ${index}.`);
        return this.chars[this.startIndex + index];
    }
    slice(startIndexInclusive : nat, endIndexExclusive? : nat) : Text {
        if (endIndexExclusive === undefined) endIndexExclusive = this.count;
        if (startIndexInclusive < 0) 
            throw new Error(`Invalid slice start ${startIndexInclusive}.`);
        if (startIndexInclusive > endIndexExclusive) 
            throw new Error(`Slice end ${endIndexExclusive} precedes slice start ${startIndexInclusive}.`);
        if (endIndexExclusive > this.count) 
            throw new Error(`Invalid slice end ${endIndexExclusive}.`);
        const count = endIndexExclusive - startIndexInclusive;
        return new TextSlice(startIndexInclusive + this.startIndex, count, this.chars);
    }
    toString() : string {
        return this.chars.join("");
    }
}
freeze(TextSlice);

class TextLinesImpl implements TextLines {

    lines : Text[]
    lineCount : nat

    constructor(lines : Text[]) {
        this.lines = lines;
        this.lineCount = lines.length;
        freeze(this);
    }

    lineAt(line : nat) : Text {
        return this.lines[line];
    }

    valid(line : nat, column : nat) : boolean {
        if (!(nat.is(line) && nat.is(column))) return false;
        if (line < this.lineCount) return column <= this.lines[line].count;
        return this.lineCount === 0 && line === 0 && column === 0;
    }

    assert(line : nat, column : nat) : void {
        if (!this.valid(line, column)) 
            throw new Error(`Invalid position ${line}:${column} in TextLines.`);
    }

    absolute(line : nat, column : nat) : [nat, nat] {
        return [line, column];
    }

}

export function createTextLines(lines : string | Text[]) : TextLines {
    if (string.is(lines)) {
        const ls = lines.split(/\n\r|\r\n|\r|\n/).map(textOf);
        return new TextLinesImpl(ls);
    } else {
        return new TextLinesImpl(lines);
    } 
}

export function copySliceOfTextLines(
    textlines : TextLines, 
    startLine : nat, startColumn : nat, 
    endLine : nat, endColumn : nat) : TextLines
{
    textlines.assert(startLine, startColumn);
    textlines.assert(endLine, endColumn);
    const lastLine = Math.min(textlines.lineCount - 1, endLine);
    let lines : Text[] = [];
    for (let i = startLine; i <= lastLine; i++) {
        const text = textlines.lineAt(i);
        const start = (i === startLine) ? startColumn : 0;
        const end = (i === endLine) ? endColumn : text.count;
        lines.push(text.slice(start, end));
    }
    return createTextLines(lines);
}

export function copySpannedTextLines(textlines : TextLines, span : Span) : Spanned<TextLines> 
{
    const copied = copySliceOfTextLines(textlines, span.startLine, span.startColumnInclusive, 
        span.endLine, span.endColumnExclusive);
    return new Spanned(span, copied);
}

const NEWLINE = textOf("\n");

export function textOfTextLines(textlines : TextLines, line_separator : Text = NEWLINE) : Text {
    let chars : TextChar[] = [];
    let separator : TextChar[] = [...line_separator];
    const count = textlines.lineCount;
    for (let i = 0; i < count; i++) {
        if (i > 0) chars.push(...separator);
        chars.push(...textlines.lineAt(i));
    }
    return textOfChars(chars);
}

export function cutoffAfterIndentation(source : TextLines, line : nat, 
    isIndented : (text : Text) => boolean) : TextLines  
{
    source.assert(line, 0);
    const lineCount = source.lineCount;
    line += 1;
    while (line < lineCount) {
        let text = source.lineAt(line);
        if (isIndented(text)) line += 1;
        else {
            const lines : TextLines = {
                lineCount: line,
                lineAt: function (l: nat): Text {
                    if (l >= lineCount) throw new Error("Invalid line.");
                    return source.lineAt(l);
                },
                valid: function (l: nat, column: nat): boolean {
                    return source.valid(l, column) && l < line;
                },
                assert: function (l: nat, column: nat): void {
                    if (!this.valid(l, column)) throw new Error("Invalid position.");
                },
                absolute: function (line: nat, column: nat): [nat, nat] {
                    return source.absolute(line, column);
                }
            };
            return lines;
        }
    }   
    return source; 
} 

export interface CutoutTextLines extends TextLines {

    shift(line : nat, column : nat) : [nat, nat] 

}

/** Represents a (possibly modified) window into an existing TextLines. */
export class TextLinesWindow implements TextLines, CutoutTextLines {

    source : TextLines

    /** The first line in the window corresponds to the startLine in the source. */
    startLine : nat  

    /** The text lines of the window. */
    lines : Text[] 

    /** The offsets at which window text lines start in the source window. */
    columns : nat[]

    /** Same as lines.length */
    lineCount : nat

    constructor(source : TextLines, startLine : number, lines : Text[], columns : nat[]) {
        if (lines.length != columns.length) throw new Error("TextLinesWindow: number of lines and columns do not match");
        this.source = source;
        this.startLine = startLine;
        this.lines = lines;
        this.columns = columns;
        this.lineCount = lines.length;
    }

    log(print : (text : string) => void = console.log) {
        print(`[TextWindow] start at line ${this.startLine}, number of lines ${this.lines.length}`);
        for (let i = 0; i < this.lines.length; i ++) {
            print(`  ${i}) '${this.lines[i]}', column ${this.columns[i]}`);
        }
    }

    lineAt(line: nat): Text {
        return this.lines[line];
    }   

    valid(line : nat, column : nat) : boolean {
        if (!(nat.is(line) && nat.is(column))) return false;
        if (line < this.lineCount) return column <= this.lines[line].count;
        return this.lineCount === 0 && line === 0 && column === 0;
    }

    assert(line : nat, column : nat) : void {
        if (!this.valid(line, column)) 
            throw new Error(`Invalid position ${line}:${column} in TextLines.`);
    }
    
    shift(line : nat, column : nat) : [nat, nat] {
        this.assert(line, column);
        return [line + this.startLine, column + this.columns[line]];
    }    
    
    absolute(line: nat, column: nat): [nat, nat] {
        return this.source.absolute(...this.shift(line, column));
    }

}

export class EmptyTextLines implements TextLines, CutoutTextLines {

    source : TextLines

    /** The position in the source to which (0, 0) corresponds, which is the only valid position. */
    startLine : nat  
    startColumn : nat

    constructor(source : TextLines, line : nat, column : nat) {
        source.assert(line, column);
        this.source = source;
        this.startLine = line;
        this.startColumn = column;
    }

    get lineCount() : nat {
        return 0;
    }

    lineAt(line: nat): Text {
        throw new Error("Out of bounds.");
    }   

    valid(line : nat, column : nat) : boolean {
        return line === 0 && column === 0;
    }

    assert(line : nat, column : nat) : void {
        if (!this.valid(line, column)) 
            throw new Error(`Invalid position ${line}:${column} in TextLines.`);
    }    
    
    absolute(line: nat, column: nat): [nat, nat] {
        this.assert(line, column);
        return this.source.absolute(this.startLine, this.startColumn);
    }

    shift(line : nat, column : nat) : [nat, nat] {
        this.assert(line, column);
        return [this.startLine, this.startColumn];
    }       

}

/** 
 * Cuts a window out of an existing TextLines.
 * 
 * The window starts at the given line and column after skipFirst, and ends
 * before the first subsequent line where skipRemaining fails.
 */
export function cutoutTextLines(source : TextLines, line : nat, column : nat, 
    skipFirst : Lexer, skipRemaining : Lexer) : CutoutTextLines 
{
    source.assert(line, column);
    if (source.lineCount === 0) return new EmptyTextLines(source, line, column);
    let text = source.lineAt(line);
    let skipped = Math.max(skipFirst(text, column), 0);
    text = text.slice(column + skipped);
    let lines : Text[] = [text];
    let columns : nat[] = [column + skipped];
    const sourceCount = source.lineCount;
    for (let i = line + 1; i < sourceCount; i++) {
        text = source.lineAt(i);
        skipped = skipRemaining(text, 0);
        if (skipped < 0) break;
        lines.push(text.slice(skipped));
        columns.push(skipped);
    }
    return new TextLinesWindow(source, line, lines, columns);
}

export function trimText(text : Text) : Text {
    let i = 0;
    while (i < text.count) {
        if (text.charAt(i) === " ") i++; else break;
    }
    let j = text.count;
    while (j > i) {
        if (text.charAt(j - 1) === " ") j--; else break;
    }
    return text.slice(i, j);
}

export function trimTextLines(textlines : TextLines) : TextLines {
    const lines : Text[] = [];
    let i = 0;
    while (i < textlines.lineCount) {
        const text = trimText(textlines.lineAt(i));
        if (text.count === 0) i++; else break;
    }
    let j = textlines.lineCount;
    while (j > i) {
        const text = trimText(textlines.lineAt(j-1));
        if (text.count === 0) j--; else break;
    }
    while (i < j) {
        lines.push(textlines.lineAt(i));
        i++;
    }
    return createTextLines(lines);
}

export class TextLinesUntil implements TextLines {

    source : TextLines

    endLine : number  

    lastLine : Text

    /** Same as lines.length */
    lineCount : number

    constructor(source : TextLines, endLine : number, endColumn : number) {
        if (endLine >= source.lineCount || endLine < 0) throw new Error("TextLinesUntil: endLine is out of range");
        this.source = source;
        this.endLine = endLine;
        let lastLine = source.lineAt(endLine);
        if (lastLine.count <= endColumn) {
            this.lastLine = lastLine;
        } else {
            this.lastLine = lastLine.slice(0, endColumn);
        }
        this.lineCount = endLine + 1;
    }

    log(print : (text : string) => void = console.log) {
        print(`[TextWindowUntil] endLine ${this.endLine} out of ${this.source.lineCount} lines:`);
        for (let i = 0; i < this.lineCount; i ++) {
            print(`  ${i}) '${this.lineAt(i)}'`);
        }
    }

    lineAt(line: number): Text {
        if (line < this.endLine) return this.source.lineAt(line); 
        else if (line === this.endLine) return this.lastLine;
        else throw new Error("Nnvalid line number " + line + ".");
    }   
    
    absolute(line: number, offset: number): [number, number] {
        return this.source.absolute(line, offset);
    }

    valid(line : nat, column : nat) : boolean {
        if (!this.source.valid(line, column)) return false;
        if (line < this.endLine) return true;
        if (line > this.endLine) return false;
        return column <= this.lastLine.count; 
    }

    assert(line : nat, column : nat) : void {
        if (!this.valid(line, column)) 
            throw new Error(`Invalid position ${line}:${column} in TextLines.`);
    }        

}

export function textlinesUntil(lines : TextLines, endLine : number, endColumn : number) : TextLines {
    if (endLine >= lines.lineCount) return lines;
    return new TextLinesUntil(lines, endLine, endColumn);
}

