import { nat, assertThings, freeze } from "things";


export class Span {

    static none = new Span(0, 0, 0, 0);

    startLine : nat
    startColumnInclusive : nat
    endLine : nat
    endColumnExclusive : nat

    constructor(
        startLine : nat,
        startColumnInclusive : nat,
        endLine : nat,
        endColumnExclusive : nat)
    {
        assertThings(nat, startLine, startColumnInclusive, endLine, endColumnExclusive);
        if (startLine > endLine) throw new Error("invalid span");
        if (startLine === endLine && startColumnInclusive > endColumnExclusive) throw new Error("invalid span");    
        this.startLine = startLine;
        this.startColumnInclusive = startColumnInclusive;
        this.endLine = endLine;
        this.endColumnExclusive = endColumnExclusive
        freeze(this);
    }
}
freeze(Span);

export function spanOfResult<T>(result : Span) : Span {
    return new Span(
        result.startLine, result.startColumnInclusive, 
        result.endLine, result.endColumnExclusive);
}

export class Spanned<T> {
    span : Span | undefined
    t : T

    constructor(span : Span | undefined, t : T) {
        this.span = span;
        this.t = t;
        freeze(this);
    }

    toString() : string {
        return "" + this.t;
    }

 /*   static fromToken<T>(lines : TextLines, token : Token<T>) : SpanStr {
        const span = spanOfResult(token);
        const text = textOfToken(lines, token);
        return new SpanStr(span, text);
    }*/

}
freeze(Spanned);
 

