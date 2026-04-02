import { SemanticTokens, SemanticTokensParams, TextDocuments, Range } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'
import FileInfoIndex, { MatlabFunctionScopeInfo, MatlabGlobalScopeInfo } from '../../indexing/FileInfoIndex'
import DocumentIndexer from '../../indexing/DocumentIndexer'

interface VariableToken {
    range: Range
    typeIndex: number
}

class SemanticTokensProvider {
    constructor(
        protected readonly documentIndexer: DocumentIndexer,
        protected readonly fileInfoIndex: FileInfoIndex
    ) { }

    async handleSemanticTokensRequest(
        params: SemanticTokensParams,
        documentManager: TextDocuments<TextDocument>
    ): Promise<SemanticTokens | null> {

        const textDocument = documentManager.get(params.textDocument.uri)
        if (!textDocument) return null

        await this.documentIndexer.ensureDocumentIndexIsUpdated(textDocument)

        const codeInfo = this.fileInfoIndex.codeInfoCache.get(params.textDocument.uri)
        if (!codeInfo) {
            return { data: [] }
        }

        const tokens: VariableToken[] = []
        this.collectVariableTokens(codeInfo.globalScopeInfo, tokens)

        tokens.sort((a, b) =>
            (a.range.start.line - b.range.start.line) ||
            (a.range.start.character - b.range.start.character)
        )

        const data: number[] = []
        let prevLine = 0
        let prevStart = 0

        for (const token of tokens) {
            const line = token.range.start.line
            const start = token.range.start.character
            const length = token.range.end.character - token.range.start.character

            const deltaLine = line - prevLine
            const deltaStart = deltaLine === 0 ? start - prevStart : start

            data.push(deltaLine, deltaStart, length, token.typeIndex, 0)
            prevLine = line
            prevStart = start
        }

        return { data }
    }

    private collectVariableTokens(
        scope: MatlabGlobalScopeInfo | MatlabFunctionScopeInfo,
        tokens: VariableToken[]
    ): void {
        for (const variableInfo of scope.variables.values()) {
            for (const ref of variableInfo.references) {
                if (ref.components.length > 0) {
                    const typeIndex = 0
                    tokens.push({ range: ref.components[0].range, typeIndex })
                }
            }
        }

        for (const nestedFunc of scope.functionScopes.values()) {
            if (nestedFunc.functionScopeInfo) {
                this.collectVariableTokens(nestedFunc.functionScopeInfo, tokens)
            }
        }
    }
}

export const SEMANTIC_TOKEN_TYPES = ['variable']
export const SEMANTIC_TOKEN_MODIFIERS: string[] = []
export default SemanticTokensProvider