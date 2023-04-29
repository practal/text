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

export function emptyP<State, T>() : Parser<State, T> {

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        const result : Result<T> = {
            type : null,
            startLine : line,
            startColumnInclusive : column,
            endLine : line,
            endColumnExclusive : column,
            children : []
        };
        return { state : state, result : result };
    }

    return parse;
}

export function failP<State, T>() : Parser<State, T> {

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        return undefined;
    }

    return parse;
}

export function seqP<State, T>(...parsers : Parser<State, T>[]) : Parser<State, T> {

    if (parsers.length === 0) return emptyP();
    if (parsers.length === 1) return parsers[0];

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        let children : Result<T>[] = [];
        const startLine = line;
        const startColumn = column;
        for (const parser of parsers) {
            const parsed = parser(state, lines, line, column);
            if (parsed === undefined) {
                return undefined;
            }
            const result = parsed.result;
            if (result.type !== undefined) {
                children.push(result);
            }
            state = parsed.state;
            line = result.endLine;
            column = result.endColumnExclusive;
        }
        const result : Result<T> = {
            type : null,
            startLine : startLine,
            startColumnInclusive : startColumn,
            endLine : line,
            endColumnExclusive : column,
            children : children
        };
        return { state : state, result : result };
    }

    return parse;
}

export function charP<State, T>(predicate : (c : TextChar) => boolean) : Parser<State, T> {

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        if (line >= lines.lineCount) return undefined;
        const text = lines.lineAt(line);
        if (column >= text.count) return undefined;
        if (!predicate(text.charAt(column))) return undefined;
        const result : Result<T> = {
            type : undefined,
            startLine : line,
            startColumnInclusive : column,
            endLine : line,
            endColumnExclusive : column + 1,
            children : []
        };
        return { state : state, result : result };
    }

    return parse;
}

export function anyCharP<State, T>() : Parser<State, T> {
    return charP(c => true);
}

export function newlineP<State, T>() : Parser<State, T> {

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        if (line + 1 < lines.lineCount && column === lines.lineAt(line).count) {
            const result : Result<T> = {
                type : undefined,
                startLine : line,
                startColumnInclusive : column,
                endLine : line + 1,
                endColumnExclusive : 0,
                children : []
            };
            return { state : state, result : result };
        } else return undefined;
    }

    return parse;
}

export function modifyParseResultP<State, T>(parser : Parser<State, T>, 
    modify : (lines : TextLines, parse_result : ParseResult<State, T>) => ParseResult<State, T>) : Parser<State, T> 
{

    function parse(state : State, lines : TextLines, line : number, column : nat) : ParseResult<State, T> { 
        return modify(lines, parser(state, lines, line, column));
    }
    
    return parse;
}

export function modifyResultP<State, T>(parser : Parser<State, T>, 
    modify : (lines : TextLines, state : State, result : Result<T>) => Result<T> | undefined) : Parser<State, T> 
{
    return modifyParseResultP(parser, (lines, parse_result) => {
        if (parse_result === undefined) return undefined;
        const result = modify(lines, parse_result.state, parse_result.result)
        if (result === undefined) return undefined;
        parse_result.result = result;
        return parse_result;
    });
}

export function modifyTypeP<State, T>(parser : Parser<State, T>, 
    type : (lines : TextLines, state : State, result : Result<T>) => T | null | undefined) : Parser<State, T> 
{
    return modifyResultP(parser, (lines, state, result) => {
        result.type = type(lines, state, result);
        return result;
    });
}

export function setTypeP<State, T>(type : T | null | undefined, parser : Parser<State, T>) : Parser<State, T> 
{
    return modifyTypeP(parser, (lines, state, result) => type);
}

export function literalP<State, T>(text : string | Text, type? : T | null) : Parser<State, T> {
    const literal = textOf(text);
    const parsers = [...literal].map(c => charP<State, T>(d => c === d));
    const parser = seqP(...parsers);
    return setTypeP(type, parser)
}

export function literalsP<State, T>(...texts : (string | Text)[]) : Parser<State, T> {
    const parsers : Parser<State, T> [] = texts.map(t => literalP(t));
    return orP(...parsers);
}

export function orP<State, T>(...parsers : Parser<State, T>[]) : Parser<State, T> {

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        for (const parser of parsers) {
            const result = parser(state, lines, line, column);
            if (result !== undefined) return result;
        }
        return undefined;
    }

    return parse;
}

export function optP<State, T>(...parsers : Parser<State, T>[]) : Parser<State, T> {
    return orP(seqP(...parsers), emptyP());
}

export function repP<State, T>(...parsers : Parser<State, T>[]) : Parser<State, T> {
    const parser = seqP(...parsers);

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        let children : Result<T>[] = [];
        const startLine = line;
        const startColumn = column;
        while (true) {
            const parsed = parser(state, lines, line, column);
            if (parsed === undefined) {
                const result: Result<T> = {
                    type : null,
                    startLine : startLine,
                    startColumnInclusive : startColumn,
                    endLine : line,
                    endColumnExclusive : column,
                    children : children
                };
                return { state : state, result : result };
            }
            state = parsed.state;
            const result = parsed.result;           
            if (result.type !== undefined) children.push(result);
            line = result.endLine;
            column = result.endColumnExclusive;
        }
    }

    return parse;
}

export function rep1P<State, T>(...parsers : Parser<State, T>[]) : Parser<State, T> {
    const parser = seqP(...parsers);
    return seqP(parser, repP(parser));
}

export function joinP<State, T>(elemP : Parser<State, T>, jointP : Parser<State, T>) : Parser<State, T> {
    return seqP(elemP, repP(jointP, elemP));
}

export function lazyP<State, T>(parser : () => Parser<State, T>) : Parser<State, T> {

    let p : Parser<State, T> | null = null;

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> { 
        if (p === null) p = parser();
        return p(state, lines, line, column);
    }

    return parse;
}

export function eofP<State, T>() : Parser<State, T> {

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        if (line === lines.lineCount || (line + 1 === lines.lineCount && column === lines.lineAt(line).count)) {
            const result : Result<T> = {
                type : undefined,
                startLine : line,
                startColumnInclusive : column,
                endLine : line,
                endColumnExclusive : column,
                children : []
            };
            return { state : state, result : result};         
        } else return undefined;
    }

    return parse;
}

export function bolP<State, T>() : Parser<State, T> {

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        if (line < lines.lineCount && column === 0) {
            const result : Result<T> = {
                type : undefined,
                startLine : line,
                startColumnInclusive : column,
                endLine : line,
                endColumnExclusive : column,
                children : []
            };
            return { state : state, result : result};         
        } else return undefined;
    }

    return parse;
}

export function eolP<State, T>() : Parser<State, T> {
    return orP(eofP(), newlineP());
}

export function shiftResult<T>(lines : CutoutTextLines, result : Result<T>) {
    const [startLine, startColumn] = lines.shift(result.startLine, result.startColumnInclusive);
    const [endLine, endColumn] = lines.shift(result.endLine, result.endColumnExclusive);
    result.startLine = startLine;
    result.startColumnInclusive = startColumn;
    result.endLine = endLine;
    result.endColumnExclusive = endColumn;
    for (const child of result.children) {
        shiftResult(lines, child);
    }
}

export function notP<State, T>(parser : Parser<State, T>) : Parser<State, T> {
    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        const parse_result = parser(state, lines, line, column);
        if (parse_result === undefined) {
            const result = joinResults<T>([], undefined, [line, column], [line, column]);
            return { state : state, result : result };
        } else {
            return undefined;
        }
    }
    return parse;
}

export function lookaheadP<State, T>(parser : Parser<State, T>) : Parser<State, T> {
    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        const parse_result = parser(state, lines, line, column);
        if (parse_result !== undefined) {
            const result = joinResults<T>([], undefined, [line, column], [line, column]);
            return { state : state, result : result };
        } else {
            return undefined;
        }
    }
    return parse;
}

/*const readWhitespaceL : Lexer = parserL(rep1P(literalP(" ")));
const readIndentationL : Lexer = 
    parserL(orP(literalP("    "), seqP(literalsP("   ", "  ", " "), eofP()))); */

export function sectionP<State, T>(
    bulletP : Parser<State, T>, 
    bodyP : (lines : TextLines, state : State, bullet_result : Result<T>) => Parser<State, T>,
    spacesL : Lexer, indentationL : Lexer, afterP : Parser<State, T>) : Parser<State, T>
{
    function isIndented(text : Text) : boolean {
        return spacesL(text, 0) > 0;
    }

    function parse(state : State, lines : TextLines, line : nat, column : nat) : ParseResult<State, T> {
        lines.assert(line, column);
        if (column > 0) return undefined;
        const start : [nat, nat] = [line, column];
        const bulletLines = cutoffAfterIndentation(lines, line, isIndented);
        const bulletParseResult = bulletP(state, bulletLines, line, column);
        if (bulletParseResult === undefined) return undefined;
        state = bulletParseResult.state;
        line = bulletParseResult.result.endLine;
        column = bulletParseResult.result.endColumnExclusive;
        const bodyLines = cutoutTextLines(lines, line, column, spacesL, indentationL);
        const bodyParser = bodyP(lines, state, bulletParseResult.result);
        const bodyParseResult = bodyParser(state, bodyLines, 0, 0);
        if (bodyParseResult === undefined) return undefined;
        const bodyResult = bodyParseResult.result;
        shiftResult(bodyLines, bodyParseResult.result);
        line = bodyResult.endLine;
        column = bodyResult.endColumnExclusive;
        state = bodyParseResult.state;
        const after = afterP(state, lines, line, column);
        const results : Result<T>[] = [bulletParseResult.result, bodyResult];
        if (after !== undefined) {
            results.push(after.result);
            state = after.state;
            line = after.result.endLine;
            column = after.result.endColumnExclusive;
        } 
        const joinedResult = joinResults(results, null, start, [line, column]);
        return { state : bodyParseResult.state, result : joinedResult };
    }

    return parse;
}


