import { Connection } from 'vscode-languageserver'
import DocumentIndexer from '../../indexing/DocumentIndexer'

/**
 * Wires semantic token invalidation to document indexing.
 *
 * When indexing completes, this schedules a debounced refresh request
 * so the client re-requests semantic tokens and updates highlighting.
 */
function setupSemanticTokenRefresh (
    connection: Connection,
    documentIndexer: DocumentIndexer
): void {
    let refreshTimer: NodeJS.Timeout | undefined

    documentIndexer.setOnIndexed(() => {
        if (refreshTimer != null) clearTimeout(refreshTimer)

        refreshTimer = setTimeout(() => {
            void connection.sendRequest('workspace/semanticTokens/refresh')
        }, 150)
    })
}

export default setupSemanticTokenRefresh
