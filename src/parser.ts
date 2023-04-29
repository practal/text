import { debug, nat, force } from "things";
import { Lexer } from "./lexer.js";
import { Span } from "./span.js";
import { TextChar, TextLines, textOf, Text, cutoffAfterIndentation, cutoutTextLines, 
    CutoutTextLines, copySliceOfTextLines, textOfTextLines } from "./textlines.js";

export type Result<T> = {
    type : T | null | undefined,  // undefined means: throw away result
    startLine : nat,
    startColumnInclusive : nat,
    endLine : nat,
    endColumnExclusive : nat,
    children : Result<T>[]
};

export type StrictResult<T> = {
    type : T, 
    startLine : nat,
    startColumnInclusive : nat,
    endLine : nat,
    endColumnExclusive : nat,
    children : Result<T>[]
};

export type ParseResult<State, T> = { state : State, result : Result<T> } | undefined;

export type Parser<State, T> = 
    (state : State, lines : TextLines, line : nat, column : nat) => ParseResult<State, T>;

export function resultCoordinatesAreValid(
    startLine : nat, startColumn : nat, endLine : nat, endColumn : nat) : boolean 
{
    if (!(nat.is(startLine) && nat.is(startColumn) && nat.is(endLine) && nat.is(endColumn))) return false;
    if (startLine !== endLine) return startLine < endLine;
    return startColumn <= endColumn;
}    

export function joinResults<T>(results : Result<T>[], type : T | null | undefined = null, 
    start? : [nat, nat], end? : [nat, nat]) : Result<T> 
{
    if (results.length === 0 && (start === undefined || end === undefined)) 
        throw new Error("There must be at least one result if not both start and end positions are provided.");
    let startLine : nat
    let startColumn : nat
    let endLine : nat
    let endColumn : nat
    if (start === undefined) {
        startLine = results[0].startLine;
        startColumn = results[0].startColumnInclusive;
    } else {
        startLine = start[0];
        startColumn = start[1];
    }
    if (end === undefined) {
        const i = results.length - 1;
        endLine = results[i].endLine;
        endColumn = results[i].endColumnExclusive;
    } else {
        endLine = end[0];
        endColumn = end[1];
    }
    let line = startLine;
    let column = startColumn;
    let children : Result<T>[] = [];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.type !== undefined) children.push(r);
        if (!resultCoordinatesAreValid(line, column, r.startLine, r.startColumnInclusive)) 
            throw new Error("Invalid relative arrangement of results encountered.");
        line = r.endLine;
        column = r.endColumnExclusive;
    }
    if (!resultCoordinatesAreValid(line, column, endLine, endColumn)) 
        throw new Error("Invalid relative arrangement of results encountered.");
    const result : Result<T> = {
        type : type,
        startLine : startLine,
        startColumnInclusive : startColumn,
        endLine : endLine,
        endColumnExclusive : endColumn,
        children : children
    };  
    return result;
}

export function startOfResult<T>(result : Result<T>) : [nat, nat] {
    return [result.startLine, result.startColumnInclusive];
}

export function endOfResult<T>(result : Result<T>) : [nat, nat] {
    return [result.endLine, result.endColumnExclusive];
}

export function textlinesOfResult<T>(lines : TextLines, result : Result<T>) : TextLines {
    return copySliceOfTextLines(lines, result.startLine, result.startColumnInclusive, 
        result.endLine, result.endColumnExclusive);
}

export function textOfResult<T>(lines : TextLines, result : Result<T>) : Text {
    return textOfTextLines(textlinesOfResult(lines, result));
}

function digits(x : number, len : number) : string {
    let s = `${x}`;
    while (s.length < len) {
        s = "0" + s;
    }
    return s;
}

export function printRange<T>(result : Result<T> | Span) : string {
    function d2(x : number) : string {
        return digits(x, 2);
    }
    const from = `${d2(result.startLine)}:${d2(result.startColumnInclusive)}`;
    const to = `${d2(result.endLine)}:${d2(result.endColumnExclusive)}`
    return `[${from} to ${to}[`;
}

export function selectResults<T>(result : Result<T>, predicate : (r : StrictResult<T>) => boolean) : StrictResult<T>[] {
    const selected : StrictResult<T>[] = [];
    function select(result : Result<T>) {
        if (result.type === null) {
            for (const child of result.children) {
                select(child);
            }
        } else if (result.type !== undefined) {
            const strict_result = result as StrictResult<T>;
            if (predicate(strict_result)) selected.push(strict_result);
        }
    }
    select(result);
    return selected;
}

export function selectResult<T>(result : Result<T>, predicate : (r : StrictResult<T>) => boolean) : StrictResult<T> {
    const results = selectResults(result, predicate);
    if (results.length === 1) return results[0];
    else throw new Error("Cannot select unique result, found " + results.length + " results.");
}

export function selectResultsIn<T>(results : Result<T>[], predicate : (r : StrictResult<T>) => boolean) : StrictResult<T>[] {
    const selected : StrictResult<T>[] = [];
    function select(result : Result<T>) {
        if (result.type === null) {
            for (const child of result.children) {
                select(child);
            }
        } else if (result.type !== undefined) {
            const strict_result = result as StrictResult<T>;
            if (predicate(strict_result)) selected.push(strict_result);
        }
    }
    for (const result of results) select(result);
    return selected;
}

export function selectResultIn<T>(results : Result<T>[], predicate : (r : StrictResult<T>) => boolean) : StrictResult<T> {
    const selected = selectResultsIn(results, predicate);
    if (selected.length === 1) return selected[0];
    else throw new Error("Cannot select unique result, found " + selected.length + " results.");
}

export function collectResultsIn<T, F>(results : Result<T>[], 
    filter : (r : StrictResult<T>) => F | undefined) : F[] 
{
    const selected : F[] = [];
    function select(result : Result<T>) {
        if (result.type === null) {
            for (const child of result.children) {
                select(child);
            }
        } else if (result.type !== undefined) {
            const strict_result = result as StrictResult<T>;
            const f = filter(strict_result);
            if (f !== undefined) selected.push(f);
        }
    }
    for (const result of results) select(result);
    return selected;
}

export function collectResultIn<T, F>(results : Result<T>[], 
    filter : (r : StrictResult<T>) => F | undefined) : F | undefined
{
    const fs = collectResultsIn(results, filter);
    if (fs.length === 1) return fs[0];
    else return undefined;
}

export function pruneResult<T>(result : Result<T>, pruned : Result<T>[]) {
    if (result.type === undefined) {}
    else if (result.type === null) {
        for (const child of result.children) pruneResult(child, pruned);
    } else {
        const children : Result<T>[] = [];
        for (const child of result.children) pruneResult(child, children);
        const p : Result<T> = {
            type: result.type,
            startLine: result.startLine,
            startColumnInclusive: result.startColumnInclusive,
            endLine: result.endLine,
            endColumnExclusive: result.endColumnExclusive,
            children: children
        };
        pruned.push(p);
    }
}

export function printResult<T>(
    lines : TextLines,
    result : Result<T>,
    nameOf : (type : T) => string = ((t : T) => "" + t),
    isOpaque : (type : T) => boolean = ((t : T) => false),
    print : (result : string) => void = debug)
{
    function process(prefix : string, result : Result<T>) {
        const type = force(result.type);
        const opaque = isOpaque(type);
        if (result.children.length === 0 && result.startLine === result.endLine) {
            const text = textOfResult(lines, result);
            if (opaque)
                print(`${printRange(result)}${prefix}   ${nameOf(type)}`);
            else
                print(`${printRange(result)}${prefix}   ${nameOf(type)} = "${text}"`);
        } else {
            print(`${printRange(result)}${prefix}   ${nameOf(type)}`);
            if (!opaque) {
                prefix += "    ";
                for (const c of result.children) {
                    process(prefix, c);
                }
            }
        }
    }
    const pruned : Result<T>[] = [];
    pruneResult(result, pruned);
    for (const p of pruned) process("", p);
}

