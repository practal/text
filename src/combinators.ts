import { CutoutTextLines, Text, TextChar, TextLines, cutoffAfterIndentation, cutoutTextLines, textOf } from "./textlines.js";
import { ParseResult, Parser, Result, joinResults } from "./parser.js";
import { nat } from "things";
import { Lexer } from "./lexer.js";

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


