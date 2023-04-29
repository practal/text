import { int, nat } from "things";
import { force, internalError } from "things";
import { ActionPlan, ActionPlanKind, planActions, planContainsError } from "./actionplan.js";
import { convertExprGrammar, ExprGrammar } from "./expr_grammar.js";
import { Sym } from "./grammar_symbols.js";
import { Action, ActionKind, computeActionsOfState, computeLR1Graph, extendGrammar, nextTerminalsOf } from "./lr.js";
import { assertNever } from "things";
import { TextLines, textlinesUntil } from "../textlines.js";
import { ParseResult, Parser, Result, endOfResult } from "../parser.js";
import { eofP } from "../combinators.js";

export type TerminalParsers<State, T> = 
    (terminals : Set<Sym | null>) => 
    (state : State, lines : TextLines, line : number, column : number) => 
    { sym : Sym | null, state : State, result : Result<T> }[];

export function mkTerminalParsers<State, T>(parsers : [Sym, Parser<State, T>][]) : TerminalParsers<State, T> {
    const parserOfSym : Map<Sym, Parser<State, T>> = new Map();
    for (const [sym, p] of parsers) parserOfSym.set(sym, p);
    if (parserOfSym.size !== parsers.length) throw new Error("Multiple parsers for same symbol found.");

    const eof : Parser<State, T> = eofP();

    return (terminals : Set<Sym | null>) => {
        const filtered_parsers : [string | null, Parser<State, T>][]= parsers.filter(p => terminals.has(p[0]));
        if (terminals.has(null)) filtered_parsers.push([null, eof]);
        function parse(state : State, lines : TextLines, line : number, offset : number) : { sym : Sym | null, state : State, result : Result<T> }[] {
            for (const [t, parser] of filtered_parsers) {
                const r = parser(state, lines, line, offset);
                if (r === undefined) continue;
                return [{sym : t, state : r.state, result : r.result}];
            }
            return [];
        }
        return parse;
    }
} 

export function orTerminalParsers<State, T>(parsers : TerminalParsers<State, T>[]) : TerminalParsers<State, T> {

    return (terminals : Set<Sym | null>) => {
        const specific_parsers = parsers.map(p => p(terminals));
        function parse(state : State, lines : TextLines, line : number, offset : number) : { sym : Sym | null, state : State, result : Result<T> }[] {
            let results : { sym : Sym | null, state : State, result : Result<T> }[] = [];
            for (const parser of specific_parsers) {
                results.push(...parser(state, lines, line, offset));
            }
            return results;
        }
        return parse;
    }

}

export function orGreedyTerminalParsers<State, T>(parsers : TerminalParsers<State, T>[]) : TerminalParsers<State, T> {

    return (terminals : Set<Sym | null>) => {
        const specific_parsers = parsers.map(p => p(terminals));
        function parse(state : State, lines : TextLines, line : number, offset : number) : { sym : Sym | null, state : State, result : Result<T> }[] {
            for (const parser of specific_parsers) {
                const results = parser(state, lines, line, offset);
                if (results.length > 0) return results;
            }
            return [];
        }
        return parse;
    }

}

export function lrP<State, T>(exprGrammar : ExprGrammar, nonterminal_labels : [Sym, T][], 
    terminal_parsers : TerminalParsers<State, T>, invalid? : T | null) : 
    { maximum_valid : Parser<State, T>, maximum_invalid : Parser<State, T>, conflicts : Set<Sym | null> } 
{
    const G = convertExprGrammar(exprGrammar);
    const X = extendGrammar(G.grammar);
    const lr1 = computeLR1Graph(X);
    /*debug("===================");
    for (let i = 0; i < G.grammar.rules.length; i++) {
        const rule = G.grammar.rules[i];
        debug("Rule " + i + ") " + rule.asString(G.symbols));
    }
    debug("===================");*/
    //console.log("Number of states is " + lr1.states.length + ".");
    //let withConflicts = 0
    const nextTerminals : Set<int>[] = [];
    const finalStates : Set<int> = new Set();
    for (let i = 0; i < lr1.states.length; i++) {
        const actions = computeActionsOfState(X, lr1, i);
        const terminals = nextTerminalsOf(actions);
        nextTerminals.push(terminals);
        for (const t of terminals) {
            if (G.symbols.is_final(t)) finalStates.add(i);
        }
    }
    //debug("final states: " + [...finalStates].join(", "));
    const plans : ActionPlan[] = [];
    const symbolsWithConflicts : Set<Sym | null> = new Set();
    for (let i = 0; i < lr1.states.length; i++) {
        const actions = computeActionsOfState(X, lr1, i);
        const plan = planActions(G.symbols, nextTerminals, actions);
        if (planContainsError(plan)) {
            //withConflicts += 1;
            //symbolsWithConflicts.add(lr1.symbols[i]);
            const sym = G.symbols.symOf(lr1.symbols[i]);
            symbolsWithConflicts.add(sym ?? null);
            /*console.log("Found conflicts in state " + i + ", belonging to " + sym);
            console.log("Actions = ");
            printActions(G.symbols, nextTerminals, actions, s => console.log("    " + s));
            console.log("Plan = ");
            printActionPlan(G.symbols, plan, s => console.log("    " + s));*/
        }
        plans.push(plan);
    }  




    //if (withConflicts > 0) throw new Error("Found " + withConflicts + " states with errors out of " + lr1.states.length + " states.");

    const rules = G.grammar.rules;

    function goto(lr_state : nat, nonterminal : int) : nat | undefined {
        const edges = lr1.graph.get(lr_state);
        if (edges === undefined) return undefined;
        return edges.get(nonterminal);
    }

    function executePlan(state : State, lines : TextLines, line : number, offset : number, plan : ActionPlan) : [Result<T>[], State, Action] | undefined {
        let tokens : Result<T>[] = [];
        let states : State[] = [state];
        let munch = 0;
        function execute(plan : ActionPlan) : Action | undefined {
            const kind = plan.kind;
            switch (kind) {
                case ActionPlanKind.ERROR: return undefined;
                case ActionPlanKind.ACCEPT: return { kind: ActionKind.ACCEPT };
                case ActionPlanKind.REDUCE: return { kind: ActionKind.REDUCE, rule: plan.rule };
                case ActionPlanKind.SHIFT: {
                    munch = plan.munch;
                    return { kind : ActionKind.SHIFT, state : plan.state };
                }
                case ActionPlanKind.READ: {
                    const terminal_symbols : Set<Sym | null> = new Set();
                    for (const option of plan.options) {
                        for (const terminal of option[0]) {
                            if (terminal === 0) terminal_symbols.add(null);
                            else {
                                const syms = G.symbols.symsOf(terminal);
                                if (syms === undefined || syms.length !== 1) throw new Error("Invalid terminal handle " + terminal + ".");
                                terminal_symbols.add(syms[0]);
                            }
                        }
                    }
                    const results = terminal_parsers(terminal_symbols)(state, lines, line, offset);
                    if (results.length !== 1) {
                        //const lo = "line " + line + ", offset " + offset;
                        //console.log("Could not READ (" + lo + "): " + [...terminal_symbols].join(" | "));
                        return undefined;
                    } 
                    const {sym, state: new_state, result} = results[0];
                    //console.log("READ " + sym);
                    [line, offset] = endOfResult(result);
                    const sym_handle = force(sym === null ? 0 : G.symbols.handleOf([sym]));
                    for (const option of plan.options) {
                        if (option[0].has(sym_handle)) {
                            state = new_state;
                            states.push(new_state);
                            tokens.push(result);
                            return execute(option[1]);
                        }
                    }
                    internalError();
                }
                default: assertNever(kind);
            }
        }
        const action = execute(plan);
        if (action === undefined) return undefined;
        tokens = tokens.slice(0, munch);
        return [tokens, states[munch], action];
    }

    const nonterminals : Map<Sym, T> = new Map();
    for (const [sym, n] of nonterminal_labels) {
        nonterminals.set(sym, n);
    }

    function mkParser(maximum_valid : boolean) : Parser<State, T> {
        function parse(state : State, lines : TextLines, line : number, offset : number) : ParseResult<State, T> {
            const startLine = line;
            const startOffset = offset;
            const startState = state;
            const lr_states : int[] = [0];
            const results : Result<T>[] = [];
            let last_valid : [number, number] | undefined = undefined;
            function failed() : ParseResult<State, T> {
                if (maximum_valid && last_valid !== undefined) {
                    const linesUntil = textlinesUntil(lines, last_valid[0], last_valid[1]);
                    //debug("parsing failed at " + line + " / " + offset + ", reset to " + last_valid[0] + " / " + last_valid[1]);
                    return mkParser(false)(startState, linesUntil, startLine, startOffset);
                }
                if (invalid === undefined) return undefined;
                const tree : Result<T> = {
                    type: invalid,
                    startLine: startLine,
                    startColumnInclusive: startOffset,
                    endLine: line,
                    endColumnExclusive: offset,
                    children: results
                };            
                return { state : state, result : tree };
            }
            while (true) {
                const lr_state = lr_states[lr_states.length - 1];
                if (finalStates.has(lr_state)) {
                    last_valid = [line, offset];
                }
                const plan = plans[lr_state];
                const executionResult = executePlan(state, lines, line, offset, plan);
                if (executionResult === undefined) {
                    /*debug("executionResult is undefined");
                    debug("----------------------------");
                    printActionPlan(G.symbols, plan);*/
                    return failed();
                }
                const [tokens, new_state, action] = executionResult;
                state = new_state;
                const kind = action.kind;
                switch (kind) {
                    case ActionKind.ACCEPT:
                        //console.log("ACCEPT");
                        if (results.length === 1) {
                            return { state : state, result : results[0] };
                        } else {
                            internalError("Unexpected result stack containing " + results.length + " results.");
                        }
                    case ActionKind.REDUCE: {
                        //console.log("REDUCE " + action.rule);
                        const rule = rules[action.rule];
                        const L = rule.rhs.length;
                        if (lr_states.length > L) {
                            const top = lr_states[lr_states.length - L - 1];
                            const goto_lr_state = goto(top, rule.lhs);
                            if (goto_lr_state === undefined) return failed();
                            const rhs = results.splice(results.length - L, L);
                            const nonterminal = G.symbols.symsOf(rule.lhs);
                            if (nonterminal === undefined || nonterminal.length !== 1) {
                                internalError("Could not resolve handle to nonterminal.");
                            }
                            const s = nonterminals.get(nonterminal[0]) ?? null;
                            let startLine = line;
                            let startOffsetInclusive = offset;
                            let endLine = line;
                            let endOffsetExclusive = offset;
                            if (rhs.length > 0) {
                                startLine = rhs[0].startLine;
                                startOffsetInclusive = rhs[0].startColumnInclusive;
                                [endLine, endOffsetExclusive] = endOfResult(rhs[rhs.length - 1]);
                            }
                            //if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(endOffsetExclusive)) throw new Error("!!");
                            const tree : Result<T> = {
                                type: s,
                                startLine: startLine,
                                startColumnInclusive: startOffsetInclusive,
                                endLine: endLine,
                                endColumnExclusive: endOffsetExclusive,
                                children: rhs
                            };
                            results.push(tree);
                            lr_states.splice(lr_states.length - L, L, goto_lr_state);
                            //console.log("GOTO " + goto_lr_state);
                        } else {
                            internalError("Stack is not large enough for reduction.");
                        }
                        break;
                    }
                    case ActionKind.SHIFT: {
                        //console.log("SHIFT " + action.state);
                        lr_states.push(action.state);
                        if (tokens.length === 1) {
                            results.push(tokens[0]);
                            [line, offset] = endOfResult(tokens[0]);
                        } else {
                            let endLine = line;
                            let endOffsetExclusive = offset;
                            if (tokens.length > 0) {
                                [endLine, endOffsetExclusive] = endOfResult(tokens[tokens.length - 1]);
                            }
                            //if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(endOffsetExclusive)) throw new Error("!!");
                            const tree : Result<T> = {
                                type: null,
                                startLine: line,
                                startColumnInclusive: offset,
                                endLine: endLine,
                                endColumnExclusive: endOffsetExclusive,
                                children: tokens
                            };   
                            results.push(tree);     
                            line = endLine;
                            offset = endOffsetExclusive;                
                        }
                        break;
                    }
                    default: assertNever(kind);
                }
            }
        }  
        return parse;      
    }


    return { maximum_valid : mkParser(true), maximum_invalid : mkParser(false), conflicts : symbolsWithConflicts };
}