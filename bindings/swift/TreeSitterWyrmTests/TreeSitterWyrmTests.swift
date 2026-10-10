import XCTest
import SwiftTreeSitter
import TreeSitterWyrm

final class TreeSitterWyrmTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_wyrm())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Wyrm grammar")
    }
}
