import assert from 'assert'
import sinon from 'sinon'
import quibble from 'quibble'

import { TextDocuments, Range } from 'vscode-languageserver'
import { TextDocument } from 'vscode-languageserver-textdocument'

import MatlabLifecycleManager from '../../../src/lifecycle/MatlabLifecycleManager'
import DocumentIndexer from '../../../src/indexing/DocumentIndexer'
import Indexer from '../../../src/indexing/Indexer'
import FileInfoIndex, { MatlabFunctionScopeInfo, MatlabGlobalScopeInfo } from '../../../src/indexing/FileInfoIndex'
import ClientConnection from '../../../src/ClientConnection'
import getMockConnection from '../../mocks/Connection.mock'
import getMockMvm from '../../mocks/Mvm.mock'
import { dynamicImport } from '../../TestUtils'

describe('SemanticTokenProvider', () => {
    const URI = 'file://test.m'

    let matlabLifecycleManager: MatlabLifecycleManager
    let fileInfoIndex: FileInfoIndex
    let indexer: Indexer
    let documentIndexer: DocumentIndexer

    let semanticTokensProvider: any
    let documentManager: TextDocuments<TextDocument>

    const setup = () => {
        const mockMvm = getMockMvm()

        matlabLifecycleManager = new MatlabLifecycleManager()
        fileInfoIndex = new FileInfoIndex()
        indexer = new Indexer(matlabLifecycleManager, mockMvm, fileInfoIndex)
        documentIndexer = new DocumentIndexer(indexer, fileInfoIndex)

        documentManager = new TextDocuments(TextDocument)

        sinon.stub(matlabLifecycleManager, 'getMatlabConnection').resolves({} as any)

        type SemanticTokensProviderExports = typeof import('../../../src/providers/semanticTokens/SemanticTokensProvider')
        const { default: SemanticTokensProvider } = dynamicImport<SemanticTokensProviderExports>(
            module, '../../../src/providers/semanticTokens/SemanticTokensProvider')

        semanticTokensProvider = new SemanticTokensProvider(
            matlabLifecycleManager,
            documentIndexer,
            fileInfoIndex
        )

        const doc = TextDocument.create(
            URI, 'matlab', 1, 'abc'
        )

        sinon.stub(documentManager, 'get').returns(doc)
    }

    const teardown = () => {
        quibble.reset()
        sinon.restore()
    }

    before(() => {
        ClientConnection._setConnection(getMockConnection())
    })

    after(() => {
        ClientConnection._clearConnection()
    })

    describe('#handleSemanticTokensRequest', () => {
        beforeEach(() => setup())
        afterEach(() => teardown())

        it('should return null if there is no MATLAB connection', async () => {
            (matlabLifecycleManager.getMatlabConnection as sinon.SinonStub).resolves(null)

            const res = await semanticTokensProvider.handleSemanticTokensRequest(
                { textDocument: { uri: URI } }, documentManager
            )

            assert.strictEqual(res, null, 'Result should be null when there is no MATLAB connection')
        })

        it('should return null if there is no document at the given URI', async () => {
            (documentManager.get as sinon.SinonStub).returns(undefined)

            const res = await semanticTokensProvider.handleSemanticTokensRequest(
                { textDocument: { uri: URI } }, documentManager
            )

            assert.strictEqual(res, null, 'Result should be null when there is no document at the given URI')
        })

        it('should return null if codeinfo is null', async () => {
            fileInfoIndex.codeInfoCache.set(URI, null as any)

            const res = await semanticTokensProvider.handleSemanticTokensRequest(
                { textDocument: { uri: URI } }, documentManager
            )

            assert.strictEqual(res, null, 'Result should be null when codeinfo is null')
        })

        it('should mark foo as a semantic function', async () => {
            const uri = URI

            const range = {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 3 } // "foo"
            }

            fileInfoIndex.codeInfoCache.set(
                URI,
                createCodeInfo({
                    functions: [
                        { name: 'foo', range: range }
                    ]
                })
            )

            const result = await semanticTokensProvider.handleSemanticTokensRequest(
                { textDocument: { uri } },
                documentManager
            )

            assert.ok(result, 'Expected semantic tokens result')

            const [deltaLine, deltaStart, length, typeIndex] = result!.data

            assert.strictEqual(typeIndex, 0, 'Expected function token type')
            assert.strictEqual(length, 3, 'Expected token length for "foo"')
        })

        it('should mark x as a semantic variable', async () => {
            const uri = URI

            const range = {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 }
            }

            fileInfoIndex.codeInfoCache.set(
                URI,
                createCodeInfo({
                    variables: [
                        { name: 'x', range: range }
                    ]
                })
            )

            const result = await semanticTokensProvider.handleSemanticTokensRequest(
                { textDocument: { uri } },
                documentManager
            )

            assert.ok(result)

            const [deltaLine, deltaStart, length, typeIndex] = result!.data

            assert.strictEqual(typeIndex, 1) // variable
            assert.strictEqual(length, 1)
        })

        it('should encode delta correctly for semantic tokens on same line', async () => {
            const uri = URI

            const range1 = {
                start: { line: 0, character: 1 },
                end: { line: 0, character: 2 } // "x"
            } as unknown as Range

            const range2 = {
                start: { line: 0, character: 5 },
                end: { line: 0, character: 6 } // "y"
            } as unknown as Range

            fileInfoIndex.codeInfoCache.set(
                URI,
                createCodeInfo({
                    variables: [
                        { name: 'x', range: range1 },
                        { name: 'y', range: range2 }
                    ]
                })
            )

            const result = await semanticTokensProvider.handleSemanticTokensRequest(
                { textDocument: { uri } } as any,
                documentManager
            )

            assert.ok(result, 'Expected semantic tokens result')

            // Token 1
            const [dl1, ds1, len1, type1] = result!.data.slice(0, 4)

            // Token 2
            const [dl2, ds2, len2, type2] = result!.data.slice(5, 9)

            // First token (absolute)
            assert.strictEqual(dl1, 0)
            assert.strictEqual(ds1, 1)

            // Second token:
            // same line → deltaLine = 0
            assert.strictEqual(dl2, 0, 'Expected same line')

            // relative start: 5 - 1 = 4
            assert.strictEqual(ds2, 4, 'Expected relative deltaStart')
        })

        it('should encode delta correctly for semantic tokens on different lines', async () => {
            const uri = URI

            const range1 = {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 } // "x"
            }

            const range2 = {
                start: { line: 2, character: 7 },
                end: { line: 2, character: 8 } // "y"
            }

            fileInfoIndex.codeInfoCache.set(
                URI,
                createCodeInfo({
                    variables: [ // Note: Variables are intentionally added in reverse order to test sorting of tokens
                        { name: 'y', range: range2 },
                        { name: 'x', range: range1 }
                    ]
                })
            )

            const result = await semanticTokensProvider.handleSemanticTokensRequest(
                { textDocument: { uri } } as any,
                documentManager
            )

            assert.ok(result, 'Expected semantic tokens result')

            // Token 1
            const [dl1, ds1, len1, type1] = result!.data.slice(0, 4)

            // Token 2
            const [dl2, ds2, len2, type2] = result!.data.slice(5, 9)

            // First token: absolute position
            assert.strictEqual(dl1, 0, 'Expected first token to have dl1 = 0, sorting should ensure this is the case')
            assert.strictEqual(ds1, 0, 'Expected first token to have ds1 = 0, sorting should ensure this is the case')

            // Second token:
            // line 2 - line 0 = 2
            assert.strictEqual(dl2, 2, 'Expected deltaLine = 2')

            // since new line → start should NOT be relative
            assert.strictEqual(ds2, 7, 'Expected absolute start on new line')
        })
    })
})

function createCodeInfo({
    variables = [],
    functions = []
}: {
    variables?: Array<{ name: string, range: Range }>
    functions?: Array<{ name: string, range: Range }>
}) {
    return {
        globalScopeInfo: {
            variables: new Map(
                variables.map(v => [
                    v.name,
                    {
                        references: [
                            { components: [{ range: v.range }] }
                        ]
                    }
                ])
            ),

            functionOrUnboundReferences: new Map(
                functions.map(f => [
                    f.name,
                    {
                        references: [
                            { components: [{ range: f.range }] }
                        ]
                    }
                ])
            ),

            functionScopes: new Map()
        }
    } as any
}