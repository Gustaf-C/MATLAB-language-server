import { SemanticTokens, SemanticTokensParams, TextDocuments, Range } from 'vscode-languageserver'
import MatlabLifecycleManager from '../../lifecycle/MatlabLifecycleManager'
import { TextDocument } from 'vscode-languageserver-textdocument'
import FileInfoIndex, { MatlabFunctionScopeInfo, MatlabGlobalScopeInfo } from '../../indexing/FileInfoIndex'
import DocumentIndexer from '../../indexing/DocumentIndexer'

interface SemanticToken {
    range: Range
    typeIndex: number
}

class SemanticTokensProvider {
    constructor (
        protected readonly matlabLifecycleManager: MatlabLifecycleManager,
        protected readonly documentIndexer: DocumentIndexer,
        protected readonly fileInfoIndex: FileInfoIndex
    ) { }

    async handleSemanticTokensRequest (
        params: SemanticTokensParams,
        documentManager: TextDocuments<TextDocument>
    ): Promise<SemanticTokens | null> {
        // This provider will be called constantly, should not connect to MATLAB just because it was called
        const matlabConnection = await this.matlabLifecycleManager.getMatlabConnection(false)
        // If MATLAB is not connected, fall back to default highlighting
        if (matlabConnection == null) return null

        const textDocument = documentManager.get(params.textDocument.uri)
        if (textDocument == null) return null

        await this.documentIndexer.ensureDocumentIndexIsUpdated(textDocument)

        const codeInfo = this.fileInfoIndex.codeInfoCache.get(params.textDocument.uri)
        if (codeInfo == null) return null

        const tokens: SemanticToken[] = []
        this.collectSemanticTokens(codeInfo.globalScopeInfo, tokens)

        // Sort tokens by their position in the document (line and character)
        // This is necessary to encode them using relative positions
        tokens.sort((a, b) => {
            const lineDiff = a.range.start.line - b.range.start.line
            if (lineDiff !== 0) return lineDiff

            return a.range.start.character - b.range.start.character
        })

        const data: number[] = []
        let prevLine = 0
        let prevStart = 0

        // Encode semantic tokens using relative line and character positions
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

    /**
     * Recursively collects semantic tokens for a given scope and its nested scopes.
     * Tokens are appended to 'tokens' in-place.
    * @param scope The scope from which semantic tokens should be collected
    * @param tokens The array to which collected semantic tokens are appended
    */
    private collectSemanticTokens (
        scope: MatlabGlobalScopeInfo | MatlabFunctionScopeInfo,
        tokens: SemanticToken[]
    ): void {
        // Variables: highlight only the first component as variable
        for (const item of scope.variables.values()) {
            for (const ref of item.references) {
                tokens.push({ range: ref.components[0].range, typeIndex: 1 }) // variable
            }
        }

        // Functions/unbound: highlight only the first component as function
        for (const item of scope.functionOrUnboundReferences.values()) {
            for (const ref of item.references) {
                tokens.push({ range: ref.components[0].range, typeIndex: 0 }) // function
            }
        }

        // Class scope
        const classScope = (scope as MatlabGlobalScopeInfo).classScope;
        if (classScope != null) {
            for (const nestedFunc of classScope.functionScopes.values()) {
                if (nestedFunc.functionScopeInfo != null) {
                    this.collectSemanticTokens(nestedFunc.functionScopeInfo, tokens);
                }
            }
        }

        // Function scopes
        for (const nestedFunc of scope.functionScopes.values()) {
            if (nestedFunc.functionScopeInfo != null) {
                this.collectSemanticTokens(nestedFunc.functionScopeInfo, tokens)
            }
        }
    }
}

export const SEMANTIC_TOKEN_TYPES = ['function', 'variable']
export const SEMANTIC_TOKEN_MODIFIERS: string[] = []
export default SemanticTokensProvider
