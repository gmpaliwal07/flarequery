import type { QueryField, QueryNode } from "../types.js";


export class ParseError extends Error {
    constructor(message: string, public readonly position: number) {
        super(`Parse error at ${position}: ${message}`);
        this.name = "ParseError";
    }
}

type TokenKind =
    | "word"
    | "string"
    | "lbrace"
    | "rbrace"
    | "lparen"
    | "rparen"
    | "colon"
    | "eof"

interface Token {
    kind: TokenKind;
    value: string;
    position: number;
}
function tokenize(input: string): Token[] {
    const tokens: Token[] = [];

    let i = 0;
    while (i < input.length) {

        if (/\s/.test(input[i]!) || input[i] === ",") {
            i++
            continue
        }

        if (input[i] === "#") {
            while (i < input.length && input[i] !== "\n") i++
            continue
        }

        if (input[i] === "{") { tokens.push({ kind: "lbrace", value: "{", position: i }); i++; continue }
        if (input[i] === "}") { tokens.push({ kind: "rbrace", value: "}", position: i }); i++; continue }
        if (input[i] === "(") { tokens.push({ kind: "lparen", value: "(", position: i }); i++; continue }
        if (input[i] === ")") { tokens.push({ kind: "rparen", value: ")", position: i }); i++; continue }
        if (input[i] === ":") { tokens.push({ kind: "colon", value: ":", position: i }); i++; continue }

        if (input[i] === '"') {
            const start = i
            i++
            let str = ""
            while (i < input.length && input[i] !== '"') {
                str += input[i]
                i++
            }
            if (i >= input.length) throw new ParseError("unterminated string literal", start)
            i++ // consume closing quote
            tokens.push({ kind: "string", value: str, position: start })
            continue
        }

        if (/[a-zA-Z_]/.test(input[i]!)) {
            const start = i
            let word = ""
            while (i < input.length && /[a-zA-Z0-9_]/.test(input[i]!)) {
                word += input[i]
                i++
            }
            tokens.push({ kind: "word", value: word, position: start })
            continue
        }

        throw new ParseError(`unexpected character '${input[i]}'`, i)
    }

    tokens.push({ kind: "eof", value: "", position: i })
    return tokens
}

class Parser {
    private pos: number = 0;

    constructor(private readonly tokens: Token[]) { }

    private peek(): Token {
        return this.tokens[this.pos]!
    }
    private consume(expectedKind?: TokenKind): Token {
        const token = this.tokens[this.pos]!

        if (expectedKind && token.kind !== expectedKind) {
            throw new ParseError(`expected ${expectedKind}, got ${token.kind}`, token.position)
        }
        this.pos++;
        return token
    }

    private consumeWord(expectedVal?: string): Token {
        const token = this.consume("word")
        if (expectedVal !== undefined && token.value !== expectedVal) {
            throw new ParseError(`expected ${expectedVal}, got ${token.value}`, token.position)
        }
        return token
    }

    parseQuery(): QueryNode {
        if (this.peek().kind === "word" && this.peek().value === "query") {
            this.consume("word")
        }
        this.consume("lbrace")
        const node = this.parseModelSelection()
        this.consume("rbrace")

        if (this.peek().kind !== "eof") {
            throw new ParseError("expected end of query", this.peek().position)
        }
        return node;
    }


    private parseModelSelection(): QueryNode {
        const modelToken = this.consumeWord();
        const model = modelToken.value;

        this.consume("lparen")
        this.consumeWord("id")
        this.consume("colon")
        const idToken = this.consume("string")
        this.consume("rparen")

        this.consume("lbrace")
        const selections = this.parseFieldList()
        this.consume("rbrace")

        return { model, id: idToken.value, selections }
    }
    private parseFieldList(): QueryField[] {
        const fields: QueryField[] = []

        while (this.peek().kind !== "rbrace" && this.peek().kind !== "eof") {
            fields.push(this.parseField())
        }

        if (fields.length === 0) {
            throw new ParseError("selection set cannot be empty", this.peek().position)
        }

        return fields
    }

    private parseField(): QueryField {
        const nameToken = this.consumeWord()
        const name = nameToken.value

        if (this.peek().kind === "lbrace") {
            this.consume("lbrace")
            const children = this.parseFieldList()
            this.consume("rbrace")
            return { name, children }
        }

        return { name, children: [] }
    }
}

// public API

export function parseQuery(input: string): QueryNode {
    const token = tokenize(input)
    const parse = new Parser(token)
    return parse.parseQuery()
}