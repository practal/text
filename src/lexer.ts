import { nat } from "things";
import { ParseResult, Parser } from "./parser.js";
import { Text, TextLines, createTextLines } from "./textlines.js";

/** Returns the length after a successful parse, and a negative number if unsuccessful. */
export type Lexer = (text : Text, column : nat) => number

export function nullP<State, T>(parser : Parser<State, T>, state : State) : Parser<null, T> {
    function parse(_ : null, lines : TextLines, line : nat, column : nat) : ParseResult<null, T> {
        const result = parser(state, lines, line, column);
        if (result === undefined) return undefined;
        return { state : null, result : result.result };
    }
    return parse;
}

export function parserL<T>(parser : Parser<null, T>) : Lexer {
    function lexer(text : Text, column : nat) : number {
        const lines = createTextLines([text]);
        const parseResult = parser(null, lines, 0, column);
        if (parseResult === undefined) return -1;
        else return parseResult.result.endColumnExclusive - column;
    }
    return lexer;
}