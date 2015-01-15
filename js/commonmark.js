!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var o;"undefined"!=typeof window?o=window:"undefined"!=typeof global?o=global:"undefined"!=typeof self&&(o=self),o.commonmark=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
"use strict";

var Node = require('./node');
var unescapeString = require('./common').unescapeString;

var C_GREATERTHAN = 62;
var C_NEWLINE = 10;
var C_SPACE = 32;
var C_OPEN_BRACKET = 91;

var InlineParser = require('./inlines');

var BLOCKTAGNAME = '(?:article|header|aside|hgroup|iframe|blockquote|hr|body|li|map|button|object|canvas|ol|caption|output|col|p|colgroup|pre|dd|progress|div|section|dl|table|td|dt|tbody|embed|textarea|fieldset|tfoot|figcaption|th|figure|thead|footer|footer|tr|form|ul|h1|h2|h3|h4|h5|h6|video|script|style)';

var HTMLBLOCKOPEN = "<(?:" + BLOCKTAGNAME + "[\\s/>]" + "|" +
        "/" + BLOCKTAGNAME + "[\\s>]" + "|" + "[?!])";

var reHtmlBlockOpen = new RegExp('^' + HTMLBLOCKOPEN, 'i');

var reHrule = /^(?:(?:\* *){3,}|(?:_ *){3,}|(?:- *){3,}) *$/;

var reMaybeSpecial = /^[ #`~*+_=<>0-9-]/;

var reNonSpace = /[^ \t\n]/;

var reBulletListMarker = /^[*+-]( +|$)/;

var reOrderedListMarker = /^(\d+)([.)])( +|$)/;

var reATXHeaderMarker = /^#{1,6}(?: +|$)/;

var reCodeFence = /^`{3,}(?!.*`)|^~{3,}(?!.*~)/;

var reClosingCodeFence = /^(?:`{3,}|~{3,})(?= *$)/;

var reSetextHeaderLine = /^(?:=+|-+) *$/;

var reLineEnding = /\r\n|\n|\r/;

// Returns true if string contains only space characters.
var isBlank = function(s) {
    return !(reNonSpace.test(s));
};

var tabSpaces = ['    ', '   ', '  ', ' '];

// Convert tabs to spaces on each line using a 4-space tab stop.
var detabLine = function(text) {
    var start = 0;
    var offset;
    var lastStop = 0;

    while ((offset = text.indexOf('\t', start)) !== -1) {
        var numspaces = (offset - lastStop) % 4;
        var spaces = tabSpaces[numspaces];
        text = text.slice(0, offset) + spaces + text.slice(offset + 1);
        lastStop = offset + numspaces;
        start = lastStop;
    }

    return text;
};

// Attempt to match a regex in string s at offset offset.
// Return index of match or -1.
var matchAt = function(re, s, offset) {
    var res = s.slice(offset).match(re);
    if (res === null) {
        return -1;
    } else {
        return offset + res.index;
    }
};

// destructively trip final blank lines in an array of strings
var stripFinalBlankLines = function(lns) {
    var i = lns.length - 1;
    while (!reNonSpace.test(lns[i])) {
        lns.pop();
        i--;
    }
};

// DOC PARSER

// These are methods of a DocParser object, defined below.

// Returns true if parent block can contain child block.
var canContain = function(parent_type, child_type) {
    return ( parent_type === 'Document' ||
             parent_type === 'BlockQuote' ||
             parent_type === 'Item' ||
             (parent_type === 'List' && child_type === 'Item') );
};

// Returns true if block type can accept lines of text.
var acceptsLines = function(block_type) {
    return ( block_type === 'Paragraph' ||
             block_type === 'IndentedCode' ||
             block_type === 'FencedCode' );
};

// Returns true if block ends with a blank line, descending if needed
// into lists and sublists.
var endsWithBlankLine = function(block) {
    while (block) {
        if (block.last_line_blank) {
            return true;
        }
        if (block.t === 'List' || block.t === 'Item') {
            block = block.lastChild;
        } else {
            break;
        }
    }
    return false;
};

// Break out of all containing lists, resetting the tip of the
// document to the parent of the highest list, and finalizing
// all the lists.  (This is used to implement the "two blank lines
// break of of all lists" feature.)
var breakOutOfLists = function(block) {
    var b = block;
    var last_list = null;
    do {
        if (b.t === 'List') {
            last_list = b;
        }
        b = b.parent;
    } while (b);

    if (last_list) {
        while (block !== last_list) {
            this.finalize(block, this.lineNumber);
            block = block.parent;
        }
        this.finalize(last_list, this.lineNumber);
        this.tip = last_list.parent;
    }
};

// Add a line to the block at the tip.  We assume the tip
// can accept lines -- that check should be done before calling this.
var addLine = function(ln, offset) {
    var s = ln.slice(offset);
    if (!(this.tip.open)) {
        throw { msg: "Attempted to add line (" + ln + ") to closed container." };
    }
    this.tip.strings.push(s);
};

// Add block of type tag as a child of the tip.  If the tip can't
// accept children, close and finalize it and try its parent,
// and so on til we find a block that can accept children.
var addChild = function(tag, offset) {
    while (!canContain(this.tip.t, tag)) {
        this.finalize(this.tip, this.lineNumber - 1);
    }

    var column_number = offset + 1; // offset 0 = column 1
    var newBlock = new Node(tag, [[this.lineNumber, column_number], [0, 0]]);
    newBlock.strings = [];
    newBlock.string_content = null;
    this.tip.appendChild(newBlock);
    this.tip = newBlock;
    return newBlock;
};

// Parse a list marker and return data on the marker (type,
// start, delimiter, bullet character, padding) or null.
var parseListMarker = function(ln, offset, indent) {
    var rest = ln.slice(offset);
    var match;
    var spaces_after_marker;
    var data = { type: null,
                 tight: true,
                 bullet_char: null,
                 start: null,
                 delimiter: null,
                 padding: null,
                 marker_offset: indent };
    if (rest.match(reHrule)) {
        return null;
    }
    if ((match = rest.match(reBulletListMarker))) {
        spaces_after_marker = match[1].length;
        data.type = 'Bullet';
        data.bullet_char = match[0][0];

    } else if ((match = rest.match(reOrderedListMarker))) {
        spaces_after_marker = match[3].length;
        data.type = 'Ordered';
        data.start = parseInt(match[1]);
        data.delimiter = match[2];
    } else {
        return null;
    }
    var blank_item = match[0].length === rest.length;
    if (spaces_after_marker >= 5 ||
        spaces_after_marker < 1 ||
        blank_item) {
        data.padding = match[0].length - spaces_after_marker + 1;
    } else {
        data.padding = match[0].length;
    }
    return data;
};

// Returns true if the two list items are of the same type,
// with the same delimiter and bullet character.  This is used
// in agglomerating list items into lists.
var listsMatch = function(list_data, item_data) {
    return (list_data.type === item_data.type &&
            list_data.delimiter === item_data.delimiter &&
            list_data.bullet_char === item_data.bullet_char);
};

// Finalize and close any unmatched blocks. Returns true.
var closeUnmatchedBlocks = function() {
    // finalize any blocks not matched
    while (this.oldtip !== this.lastMatchedContainer) {
        this.finalize(this.oldtip, this.lineNumber - 1);
        this.oldtip = this.oldtip.parent;
    }
    return true;
};

// Analyze a line of text and update the document appropriately.
// We parse markdown text by calling this on each line of input,
// then finalizing the document.
var incorporateLine = function(ln) {
    var all_matched = true;
    var first_nonspace;
    var offset = 0;
    var match;
    var data;
    var blank;
    var indent;
    var i;
    var CODE_INDENT = 4;
    var allClosed;

    var container = this.doc;
    this.oldtip = this.tip;

    // replace NUL characters for security
    if (ln.indexOf('\u0000') !== -1) {
        ln = ln.replace(/\0/g, '\uFFFD');
    }

    // Convert tabs to spaces:
    ln = detabLine(ln);

    // For each containing block, try to parse the associated line start.
    // Bail out on failure: container will point to the last matching block.
    // Set all_matched to false if not all containers match.
    while (container.lastChild) {
        if (!container.lastChild.open) {
            break;
        }
        container = container.lastChild;

        match = matchAt(reNonSpace, ln, offset);
        if (match === -1) {
            first_nonspace = ln.length;
            blank = true;
        } else {
            first_nonspace = match;
            blank = false;
        }
        indent = first_nonspace - offset;

        switch (container.t) {
        case 'BlockQuote':
            if (indent <= 3 && ln.charCodeAt(first_nonspace) === C_GREATERTHAN) {
                offset = first_nonspace + 1;
                if (ln.charCodeAt(offset) === C_SPACE) {
                    offset++;
                }
            } else {
                all_matched = false;
            }
            break;

        case 'Item':
            if (indent >= container.list_data.marker_offset +
                container.list_data.padding) {
                offset += container.list_data.marker_offset +
                    container.list_data.padding;
            } else if (blank) {
                offset = first_nonspace;
            } else {
                all_matched = false;
            }
            break;

        case 'IndentedCode':
            if (indent >= CODE_INDENT) {
                offset += CODE_INDENT;
            } else if (blank) {
                offset = first_nonspace;
            } else {
                all_matched = false;
            }
            break;

        case 'Header':
        case 'HorizontalRule':
            // a header can never container > 1 line, so fail to match:
            all_matched = false;
            if (blank) {
                container.last_line_blank = true;
            }
            break;

        case 'FencedCode':
            // skip optional spaces of fence offset
            i = container.fence_offset;
            while (i > 0 && ln.charCodeAt(offset) === C_SPACE) {
                offset++;
                i--;
            }
            break;

        case 'HtmlBlock':
            if (blank) {
                container.last_line_blank = true;
                all_matched = false;
            }
            break;

        case 'Paragraph':
            if (blank) {
                container.last_line_blank = true;
                all_matched = false;
            }
            break;

        default:
        }

        if (!all_matched) {
            container = container.parent; // back up to last matching block
            break;
        }
    }

    allClosed = (container === this.oldtip);
    this.lastMatchedContainer = container;

    // Check to see if we've hit 2nd blank line; if so break out of list:
    if (blank && container.last_line_blank) {
        this.breakOutOfLists(container);
    }

    // Unless last matched container is a code block, try new container starts,
    // adding children to the last matched container:
    while (container.t !== 'FencedCode' &&
           container.t !== 'IndentedCode' &&
           container.t !== 'HtmlBlock' &&
           // this is a little performance optimization:
           matchAt(reMaybeSpecial, ln, offset) !== -1) {

        match = matchAt(reNonSpace, ln, offset);
        if (match === -1) {
            first_nonspace = ln.length;
            blank = true;
            break;
        } else {
            first_nonspace = match;
            blank = false;
        }
        indent = first_nonspace - offset;

        if (indent >= CODE_INDENT) {
            // indented code
            if (this.tip.t !== 'Paragraph' && !blank) {
                offset += CODE_INDENT;
                allClosed = allClosed ||
                    this.closeUnmatchedBlocks();
                container = this.addChild('IndentedCode', offset);
            }
            break;
        }

        offset = first_nonspace;

        var cc = ln.charCodeAt(offset);

        if (cc === C_GREATERTHAN) {
            // blockquote
            offset += 1;
            // optional following space
            if (ln.charCodeAt(offset) === C_SPACE) {
                offset++;
            }
            allClosed = allClosed || this.closeUnmatchedBlocks();
            container = this.addChild('BlockQuote', first_nonspace);

        } else if ((match = ln.slice(offset).match(reATXHeaderMarker))) {
            // ATX header
            offset += match[0].length;
            allClosed = allClosed || this.closeUnmatchedBlocks();
            container = this.addChild('Header', first_nonspace);
            container.level = match[0].trim().length; // number of #s
            // remove trailing ###s:
            container.strings =
                [ln.slice(offset).replace(/^ *#+ *$/, '').replace(/ +#+ *$/, '')];
            break;

        } else if ((match = ln.slice(offset).match(reCodeFence))) {
            // fenced code block
            var fence_length = match[0].length;
            allClosed = allClosed || this.closeUnmatchedBlocks();
            container = this.addChild('FencedCode', first_nonspace);
            container.fence_length = fence_length;
            container.fence_char = match[0][0];
            container.fence_offset = indent;
            offset += fence_length;
            break;

        } else if (matchAt(reHtmlBlockOpen, ln, offset) !== -1) {
            // html block
            allClosed = allClosed || this.closeUnmatchedBlocks();
            container = this.addChild('HtmlBlock', offset);
            offset -= indent; // back up so spaces are part of block
            break;

        } else if (container.t === 'Paragraph' &&
                   container.strings.length === 1 &&
                   ((match = ln.slice(offset).match(reSetextHeaderLine)))) {
            // setext header line
            allClosed = allClosed || this.closeUnmatchedBlocks();
            container.t = 'Header'; // convert Paragraph to SetextHeader
            container.level = match[0][0] === '=' ? 1 : 2;
            offset = ln.length;
            break;

        } else if (matchAt(reHrule, ln, offset) !== -1) {
            // hrule
            allClosed = allClosed || this.closeUnmatchedBlocks();
            container = this.addChild('HorizontalRule', first_nonspace);
            offset = ln.length - 1;
            break;

        } else if ((data = parseListMarker(ln, offset, indent))) {
            // list item
            allClosed = allClosed || this.closeUnmatchedBlocks();
            offset += data.padding;

            // add the list if needed
            if (container.t !== 'List' ||
                !(listsMatch(container.list_data, data))) {
                container = this.addChild('List', first_nonspace);
                container.list_data = data;
            }

            // add the list item
            container = this.addChild('Item', first_nonspace);
            container.list_data = data;

        } else {
            break;

        }

    }

    // What remains at the offset is a text line.  Add the text to the
    // appropriate container.

    match = matchAt(reNonSpace, ln, offset);
    if (match === -1) {
        first_nonspace = ln.length;
        blank = true;
    } else {
        first_nonspace = match;
        blank = false;
    }
    indent = first_nonspace - offset;

    // First check for a lazy paragraph continuation:
    if (!allClosed && !blank &&
        this.tip.t === 'Paragraph' &&
        this.tip.strings.length > 0) {
        // lazy paragraph continuation

        this.last_line_blank = false;
        this.addLine(ln, offset);

    } else { // not a lazy continuation

        // finalize any blocks not matched
        allClosed = allClosed || this.closeUnmatchedBlocks();

        // Block quote lines are never blank as they start with >
        // and we don't count blanks in fenced code for purposes of tight/loose
        // lists or breaking out of lists.  We also don't set last_line_blank
        // on an empty list item.
        container.last_line_blank = blank &&
            !(container.t === 'BlockQuote' ||
              container.t === 'Header' ||
              container.t === 'FencedCode' ||
              (container.t === 'Item' &&
               !container.firstChild &&
               container.sourcepos[0][0] === this.lineNumber));

        var cont = container;
        while (cont.parent) {
            cont.parent.last_line_blank = false;
            cont = cont.parent;
        }

        switch (container.t) {
        case 'IndentedCode':
        case 'HtmlBlock':
            this.addLine(ln, offset);
            break;

        case 'FencedCode':
            // check for closing code fence:
            match = (indent <= 3 &&
                     ln.charAt(first_nonspace) === container.fence_char &&
                     ln.slice(first_nonspace).match(reClosingCodeFence));
            if (match && match[0].length >= container.fence_length) {
                // don't add closing fence to container; instead, close it:
                this.finalize(container, this.lineNumber);
            } else {
                this.addLine(ln, offset);
            }
            break;

        case 'Header':
        case 'HorizontalRule':
            // nothing to do; we already added the contents.
            break;

        default:
            if (acceptsLines(container.t)) {
                this.addLine(ln, first_nonspace);
            } else if (blank) {
                break;
            } else {
                // create paragraph container for line
                container = this.addChild('Paragraph', this.lineNumber, first_nonspace);
                this.addLine(ln, first_nonspace);
            }
        }
    }
    this.lastLineLength = ln.length - 1; // -1 for newline
};

// Finalize a block.  Close it and do any necessary postprocessing,
// e.g. creating string_content from strings, setting the 'tight'
// or 'loose' status of a list, and parsing the beginnings
// of paragraphs for reference definitions.  Reset the tip to the
// parent of the closed block.
var finalize = function(block, lineNumber) {
    var pos;
    // don't do anything if the block is already closed
    if (!block.open) {
        return 0;
    }
    block.open = false;
    block.sourcepos[1] = [lineNumber, this.lastLineLength + 1];

    switch (block.t) {
    case 'Paragraph':
        block.string_content = block.strings.join('\n');

        // try parsing the beginning as link reference definitions:
        while (block.string_content.charCodeAt(0) === C_OPEN_BRACKET &&
               (pos = this.inlineParser.parseReference(block.string_content,
                                                       this.refmap))) {
            block.string_content = block.string_content.slice(pos);
            if (isBlank(block.string_content)) {
                block.t = 'ReferenceDef';
                break;
            }
        }
        break;

    case 'Header':
        block.string_content = block.strings.join('\n');
        break;

    case 'HtmlBlock':
        block.literal = block.strings.join('\n');
        break;

    case 'IndentedCode':
        stripFinalBlankLines(block.strings);
        block.literal = block.strings.join('\n') + '\n';
        block.t = 'CodeBlock';
        break;

    case 'FencedCode':
        // first line becomes info string
        block.info = unescapeString(block.strings[0].trim());
        if (block.strings.length === 1) {
            block.literal = '';
        } else {
            block.literal = block.strings.slice(1).join('\n') + '\n';
        }
        block.t = 'CodeBlock';
        break;

    case 'List':
        block.list_data.tight = true; // tight by default

        var item = block.firstChild;
        while (item) {
            // check for non-final list item ending with blank line:
            if (endsWithBlankLine(item) && item.next) {
                block.list_data.tight = false;
                break;
            }
            // recurse into children of list item, to see if there are
            // spaces between any of them:
            var subitem = item.firstChild;
            while (subitem) {
                if (endsWithBlankLine(subitem) && (item.next || subitem.next)) {
                    block.list_data.tight = false;
                    break;
                }
                subitem = subitem.next;
            }
            item = item.next;
        }
        break;

    default:
        break;
    }

    this.tip = block.parent || this.top;
};

// Walk through a block & children recursively, parsing string content
// into inline content where appropriate.  Returns new object.
var processInlines = function(block) {
    var node, event;
    var walker = block.walker();
    while ((event = walker.next())) {
        node = event.node;
        if (!event.entering && (node.t === 'Paragraph' ||
                                node.t === 'Header')) {
            this.inlineParser.parse(node, this.refmap);
        }
    }
};

var Document = function() {
    var doc = new Node('Document', [[1, 1], [0, 0]]);
    doc.string_content = null;
    doc.strings = [];
    return doc;
};

// The main parsing function.  Returns a parsed document AST.
var parse = function(input) {
    this.doc = new Document();
    this.tip = this.doc;
    this.refmap = {};
    if (this.options.time) { console.time("preparing input"); }
    var lines = input.split(reLineEnding);
    var len = lines.length;
    if (input.charCodeAt(input.length - 1) === C_NEWLINE) {
        // ignore last blank line created by final newline
        len -= 1;
    }
    if (this.options.time) { console.timeEnd("preparing input"); }
    if (this.options.time) { console.time("block parsing"); }
    for (var i = 0; i < len; i++) {
        this.lineNumber += 1;
        this.incorporateLine(lines[i]);
    }
    while (this.tip) {
        this.finalize(this.tip, len);
    }
    if (this.options.time) { console.timeEnd("block parsing"); }
    if (this.options.time) { console.time("inline parsing"); }
    this.processInlines(this.doc);
    if (this.options.time) { console.timeEnd("inline parsing"); }
    return this.doc;
};


// The DocParser object.
function DocParser(options){
    return {
        doc: new Document(),
        tip: this.doc,
        oldtip: this.doc,
        lineNumber: 0,
        lastMatchedContainer: this.doc,
        refmap: {},
        lastLineLength: 0,
        inlineParser: new InlineParser(),
        breakOutOfLists: breakOutOfLists,
        addLine: addLine,
        addChild: addChild,
        incorporateLine: incorporateLine,
        finalize: finalize,
        processInlines: processInlines,
        closeUnmatchedBlocks: closeUnmatchedBlocks,
        parse: parse,
        options: options || {}
    };
}

module.exports = DocParser;

},{"./common":2,"./inlines":7,"./node":8}],2:[function(require,module,exports){
"use strict";

var entityToChar = require('./html5-entities.js').entityToChar;

var ENTITY = "&(?:#x[a-f0-9]{1,8}|#[0-9]{1,8}|[a-z][a-z0-9]{1,31});";

var reBackslashOrAmp = /[\\&]/;

var ESCAPABLE = '[!"#$%&\'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]';

var reEntityOrEscapedChar = new RegExp('\\\\' + ESCAPABLE + '|' + ENTITY, 'gi');

var XMLSPECIAL = '[&<>"]';

var reXmlSpecial = new RegExp(XMLSPECIAL, 'g');

var reXmlSpecialOrEntity = new RegExp(ENTITY + '|' + XMLSPECIAL, 'gi');

var unescapeChar = function(s) {
    if (s[0] === '\\') {
        return s[1];
    } else {
        return entityToChar(s);
    }
};

// Replace entities and backslash escapes with literal characters.
var unescapeString = function(s) {
    if (reBackslashOrAmp.test(s)) {
        return s.replace(reEntityOrEscapedChar, unescapeChar);
    } else {
        return s;
    }
};

var normalizeURI = function(uri) {
    try {
        return encodeURI(decodeURI(uri));
    }
    catch(err) {
        return uri;
    }
};

var replaceUnsafeChar = function(s) {
    switch (s) {
    case '&':
        return '&amp;';
    case '<':
        return '&lt;';
    case '>':
        return '&gt;';
    case '"':
        return '&quot;';
    default:
        return s;
    }
};

var escapeXml = function(s, preserve_entities) {
    if (reXmlSpecial.test(s)) {
        if (preserve_entities) {
            return s.replace(reXmlSpecialOrEntity, replaceUnsafeChar);
        } else {
            return s.replace(reXmlSpecial, replaceUnsafeChar);
        }
    } else {
        return s;
    }
};

module.exports = { unescapeString: unescapeString,
                   normalizeURI: normalizeURI,
                   escapeXml: escapeXml
                 };

},{"./html5-entities.js":5}],3:[function(require,module,exports){
"use strict";

// derived from https://github.com/mathiasbynens/String.fromCodePoint
/*! http://mths.be/fromcodepoint v0.2.1 by @mathias */
if (String.fromCodePoint) {
    module.exports = function (_) {
        try {
            return String.fromCodePoint(_);
        } catch (e) {
            if (e instanceof RangeError) {
                return String.fromCharCode(0xFFFD);
            }
            throw e;
        }
    };

} else {

  var stringFromCharCode = String.fromCharCode;
  var floor = Math.floor;
  var fromCodePoint = function() {
      var MAX_SIZE = 0x4000;
      var codeUnits = [];
      var highSurrogate;
      var lowSurrogate;
      var index = -1;
      var length = arguments.length;
      if (!length) {
          return '';
      }
      var result = '';
      while (++index < length) {
          var codePoint = Number(arguments[index]);
          if (
              !isFinite(codePoint) || // `NaN`, `+Infinity`, or `-Infinity`
                  codePoint < 0 || // not a valid Unicode code point
                  codePoint > 0x10FFFF || // not a valid Unicode code point
                  floor(codePoint) !== codePoint // not an integer
          ) {
              return String.fromCharCode(0xFFFD);
          }
          if (codePoint <= 0xFFFF) { // BMP code point
              codeUnits.push(codePoint);
          } else { // Astral code point; split in surrogate halves
              // http://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
              codePoint -= 0x10000;
              highSurrogate = (codePoint >> 10) + 0xD800;
              lowSurrogate = (codePoint % 0x400) + 0xDC00;
              codeUnits.push(highSurrogate, lowSurrogate);
          }
          if (index + 1 === length || codeUnits.length > MAX_SIZE) {
              result += stringFromCharCode.apply(null, codeUnits);
              codeUnits.length = 0;
          }
      }
      return result;
  };
  module.exports = fromCodePoint;
}

},{}],4:[function(require,module,exports){
"use strict";

var escapeXml = require('./common').escapeXml;

// Helper function to produce an HTML tag.
var tag = function(name, attrs, selfclosing) {
    var result = '<' + name;
    if (attrs && attrs.length > 0) {
        var i = 0;
        var attrib;
        while ((attrib = attrs[i]) !== undefined) {
            result += ' ' + attrib[0] + '="' + attrib[1] + '"';
            i++;
        }
    }
    if (selfclosing) {
        result += ' /';
    }

    result += '>';
    return result;
};

var reHtmlTag = /\<[^>]*\>/;

var renderNodes = function(block) {

    var attrs;
    var info_words;
    var tagname;
    var walker = block.walker();
    var event, node, entering;
    var buffer = "";
    var lastOut = "\n";
    var disableTags = 0;
    var grandparent;
    var out = function(s) {
        if (disableTags > 0) {
            buffer += s.replace(reHtmlTag, '');
        } else {
            buffer += s;
        }
        lastOut = s;
    };
    var esc = this.escape;
    var cr = function() {
        if (lastOut !== '\n') {
            buffer += '\n';
            lastOut = '\n';
        }
    };

    var options = this.options;

    if (options.time) { console.time("rendering"); }

    while ((event = walker.next())) {
        entering = event.entering;
        node = event.node;

        attrs = [];
        if (options.sourcepos) {
            var pos = node.sourcepos;
            if (pos) {
                attrs.push(['data-sourcepos', String(pos[0][0]) + ':' +
                            String(pos[0][1]) + '-' + String(pos[1][0]) + ':' +
                            String(pos[1][1])]);
            }
        }

        switch (node.t) {
        case 'Text':
            out(esc(node.literal));
            break;

        case 'Softbreak':
            out(this.softbreak);
            break;

        case 'Hardbreak':
            out(tag('br', [], true));
            cr();
            break;

        case 'Emph':
            out(tag(entering ? 'em' : '/em'));
            break;

        case 'Strong':
            out(tag(entering ? 'strong' : '/strong'));
            break;

        case 'Html':
            out(node.literal);
            break;

        case 'Link':
            if (entering) {
                attrs.push(['href', esc(node.destination, true)]);
                if (node.title) {
                    attrs.push(['title', esc(node.title, true)]);
                }
                out(tag('a', attrs));
            } else {
                out(tag('/a'));
            }
            break;

        case 'Image':
            if (entering) {
                if (disableTags === 0) {
                    out('<img src="' + esc(node.destination, true) +
                        '" alt="');
                }
                disableTags += 1;
            } else {
                disableTags -= 1;
                if (disableTags === 0) {
                    if (node.title) {
                        out('" title="' + esc(node.title, true));
                    }
                    out('" />');
                }
            }
            break;

        case 'Code':
            out(tag('code') + esc(node.literal) + tag('/code'));
            break;

        case 'Document':
            break;

        case 'Paragraph':
            grandparent = node.parent.parent;
            if (grandparent !== null &&
                grandparent.t === 'List') {
                if (grandparent.list_data.tight) {
                    break;
                }
            }
            if (entering) {
                cr();
                out(tag('p', attrs));
            } else {
                out(tag('/p'));
                cr();
            }
            break;

        case 'BlockQuote':
            if (entering) {
                cr();
                out(tag('blockquote', attrs));
                cr();
            } else {
                cr();
                out(tag('/blockquote'));
                cr();
            }
            break;

        case 'Item':
            if (entering) {
                out(tag('li', attrs));
            } else {
                out(tag('/li'));
                cr();
            }
            break;

        case 'List':
            tagname = node.list_data.type === 'Bullet' ? 'ul' : 'ol';
            if (entering) {
                if (node.list_data.start && node.list_data.start > 1) {
                    attrs.push(['start', node.list_data.start.toString()]);
                }
                cr();
                out(tag(tagname, attrs));
                cr();
            } else {
                cr();
                out(tag('/' + tagname));
                cr();
            }
            break;

        case 'Header':
            tagname = 'h' + node.level;
            if (entering) {
                cr();
                out(tag(tagname, attrs));
            } else {
                out(tag('/' + tagname));
                cr();
            }
            break;

        case 'CodeBlock':
            info_words = node.info ? node.info.split(/ +/) : [];
            if (info_words.length > 0 && info_words[0].length > 0) {
                attrs.push(['class', 'language-' + esc(info_words[0], true)]);
            }
            cr();
            out(tag('pre') + tag('code', attrs));
            out(esc(node.literal));
            out(tag('/code') + tag('/pre'));
            cr();
            break;

        case 'HtmlBlock':
            cr();
            out(node.literal);
            cr();
            break;

        case 'HorizontalRule':
            cr();
            out(tag('hr', attrs, true));
            cr();
            break;


        case 'ReferenceDef':
            break;

        default:
            throw "Unknown node type " + node.t;
        }

    }
    if (options.time) { console.timeEnd("rendering"); }
    return buffer;
};

// The HtmlRenderer object.
function HtmlRenderer(options){
    return {
        // default options:
        softbreak: '\n', // by default, soft breaks are rendered as newlines in HTML
        // set to "<br />" to make them hard breaks
        // set to " " if you want to ignore line wrapping in source
        escape: escapeXml,
        options: options || {},
        render: renderNodes
    };
}

module.exports = HtmlRenderer;

},{"./common":2}],5:[function(require,module,exports){
"use strict";

var fromCodePoint = require('./from-code-point');

var entities = {
  AAacute: 193,
  aacute: 225,
  Abreve: 258,
  abreve: 259,
  ac: 8766,
  acd: 8767,
  acE: 8766,
  Acirc: 194,
  acirc: 226,
  acute: 180,
  Acy: 1040,
  acy: 1072,
  AElig: 198,
  aelig: 230,
  af: 8289,
  Afr: 55349,
  afr: 55349,
  Agrave: 192,
  agrave: 224,
  alefsym: 8501,
  aleph: 8501,
  Alpha: 913,
  alpha: 945,
  Amacr: 256,
  amacr: 257,
  amalg: 10815,
  amp: 38,
  AMP: 38,
  andand: 10837,
  And: 10835,
  and: 8743,
  andd: 10844,
  andslope: 10840,
  andv: 10842,
  ang: 8736,
  ange: 10660,
  angle: 8736,
  angmsdaa: 10664,
  angmsdab: 10665,
  angmsdac: 10666,
  angmsdad: 10667,
  angmsdae: 10668,
  angmsdaf: 10669,
  angmsdag: 10670,
  angmsdah: 10671,
  angmsd: 8737,
  angrt: 8735,
  angrtvb: 8894,
  angrtvbd: 10653,
  angsph: 8738,
  angst: 197,
  angzarr: 9084,
  Aogon: 260,
  aogon: 261,
  Aopf: 55349,
  aopf: 55349,
  apacir: 10863,
  ap: 8776,
  apE: 10864,
  ape: 8778,
  apid: 8779,
  apos: 39,
  ApplyFunction: 8289,
  approx: 8776,
  approxeq: 8778,
  Aring: 197,
  aring: 229,
  Ascr: 55349,
  ascr: 55349,
  Assign: 8788,
  ast: 42,
  asymp: 8776,
  asympeq: 8781,
  Atilde: 195,
  atilde: 227,
  Auml: 196,
  auml: 228,
  awconint: 8755,
  awint: 10769,
  backcong: 8780,
  backepsilon: 1014,
  backprime: 8245,
  backsim: 8765,
  backsimeq: 8909,
  Backslash: 8726,
  Barv: 10983,
  barvee: 8893,
  barwed: 8965,
  Barwed: 8966,
  barwedge: 8965,
  bbrk: 9141,
  bbrktbrk: 9142,
  bcong: 8780,
  Bcy: 1041,
  bcy: 1073,
  bdquo: 8222,
  becaus: 8757,
  because: 8757,
  Because: 8757,
  bemptyv: 10672,
  bepsi: 1014,
  bernou: 8492,
  Bernoullis: 8492,
  Beta: 914,
  beta: 946,
  beth: 8502,
  between: 8812,
  Bfr: 55349,
  bfr: 55349,
  bigcap: 8898,
  bigcirc: 9711,
  bigcup: 8899,
  bigodot: 10752,
  bigoplus: 10753,
  bigotimes: 10754,
  bigsqcup: 10758,
  bigstar: 9733,
  bigtriangledown: 9661,
  bigtriangleup: 9651,
  biguplus: 10756,
  bigvee: 8897,
  bigwedge: 8896,
  bkarow: 10509,
  blacklozenge: 10731,
  blacksquare: 9642,
  blacktriangle: 9652,
  blacktriangledown: 9662,
  blacktriangleleft: 9666,
  blacktriangleright: 9656,
  blank: 9251,
  blk12: 9618,
  blk14: 9617,
  blk34: 9619,
  block: 9608,
  bne: 61,
  bnequiv: 8801,
  bNot: 10989,
  bnot: 8976,
  Bopf: 55349,
  bopf: 55349,
  bot: 8869,
  bottom: 8869,
  bowtie: 8904,
  boxbox: 10697,
  boxdl: 9488,
  boxdL: 9557,
  boxDl: 9558,
  boxDL: 9559,
  boxdr: 9484,
  boxdR: 9554,
  boxDr: 9555,
  boxDR: 9556,
  boxh: 9472,
  boxH: 9552,
  boxhd: 9516,
  boxHd: 9572,
  boxhD: 9573,
  boxHD: 9574,
  boxhu: 9524,
  boxHu: 9575,
  boxhU: 9576,
  boxHU: 9577,
  boxminus: 8863,
  boxplus: 8862,
  boxtimes: 8864,
  boxul: 9496,
  boxuL: 9563,
  boxUl: 9564,
  boxUL: 9565,
  boxur: 9492,
  boxuR: 9560,
  boxUr: 9561,
  boxUR: 9562,
  boxv: 9474,
  boxV: 9553,
  boxvh: 9532,
  boxvH: 9578,
  boxVh: 9579,
  boxVH: 9580,
  boxvl: 9508,
  boxvL: 9569,
  boxVl: 9570,
  boxVL: 9571,
  boxvr: 9500,
  boxvR: 9566,
  boxVr: 9567,
  boxVR: 9568,
  bprime: 8245,
  breve: 728,
  Breve: 728,
  brvbar: 166,
  bscr: 55349,
  Bscr: 8492,
  bsemi: 8271,
  bsim: 8765,
  bsime: 8909,
  bsolb: 10693,
  bsol: 92,
  bsolhsub: 10184,
  bull: 8226,
  bullet: 8226,
  bump: 8782,
  bumpE: 10926,
  bumpe: 8783,
  Bumpeq: 8782,
  bumpeq: 8783,
  Cacute: 262,
  cacute: 263,
  capand: 10820,
  capbrcup: 10825,
  capcap: 10827,
  cap: 8745,
  Cap: 8914,
  capcup: 10823,
  capdot: 10816,
  CapitalDifferentialD: 8517,
  caps: 8745,
  caret: 8257,
  caron: 711,
  Cayleys: 8493,
  ccaps: 10829,
  Ccaron: 268,
  ccaron: 269,
  Ccedil: 199,
  ccedil: 231,
  Ccirc: 264,
  ccirc: 265,
  Cconint: 8752,
  ccups: 10828,
  ccupssm: 10832,
  Cdot: 266,
  cdot: 267,
  cedil: 184,
  Cedilla: 184,
  cemptyv: 10674,
  cent: 162,
  centerdot: 183,
  CenterDot: 183,
  cfr: 55349,
  Cfr: 8493,
  CHcy: 1063,
  chcy: 1095,
  check: 10003,
  checkmark: 10003,
  Chi: 935,
  chi: 967,
  circ: 710,
  circeq: 8791,
  circlearrowleft: 8634,
  circlearrowright: 8635,
  circledast: 8859,
  circledcirc: 8858,
  circleddash: 8861,
  CircleDot: 8857,
  circledR: 174,
  circledS: 9416,
  CircleMinus: 8854,
  CirclePlus: 8853,
  CircleTimes: 8855,
  cir: 9675,
  cirE: 10691,
  cire: 8791,
  cirfnint: 10768,
  cirmid: 10991,
  cirscir: 10690,
  ClockwiseContourIntegral: 8754,
  CloseCurlyDoubleQuote: 8221,
  CloseCurlyQuote: 8217,
  clubs: 9827,
  clubsuit: 9827,
  colon: 58,
  Colon: 8759,
  Colone: 10868,
  colone: 8788,
  coloneq: 8788,
  comma: 44,
  commat: 64,
  comp: 8705,
  compfn: 8728,
  complement: 8705,
  complexes: 8450,
  cong: 8773,
  congdot: 10861,
  Congruent: 8801,
  conint: 8750,
  Conint: 8751,
  ContourIntegral: 8750,
  copf: 55349,
  Copf: 8450,
  coprod: 8720,
  Coproduct: 8720,
  copy: 169,
  COPY: 169,
  copysr: 8471,
  CounterClockwiseContourIntegral: 8755,
  crarr: 8629,
  cross: 10007,
  Cross: 10799,
  Cscr: 55349,
  cscr: 55349,
  csub: 10959,
  csube: 10961,
  csup: 10960,
  csupe: 10962,
  ctdot: 8943,
  cudarrl: 10552,
  cudarrr: 10549,
  cuepr: 8926,
  cuesc: 8927,
  cularr: 8630,
  cularrp: 10557,
  cupbrcap: 10824,
  cupcap: 10822,
  CupCap: 8781,
  cup: 8746,
  Cup: 8915,
  cupcup: 10826,
  cupdot: 8845,
  cupor: 10821,
  cups: 8746,
  curarr: 8631,
  curarrm: 10556,
  curlyeqprec: 8926,
  curlyeqsucc: 8927,
  curlyvee: 8910,
  curlywedge: 8911,
  curren: 164,
  curvearrowleft: 8630,
  curvearrowright: 8631,
  cuvee: 8910,
  cuwed: 8911,
  cwconint: 8754,
  cwint: 8753,
  cylcty: 9005,
  dagger: 8224,
  Dagger: 8225,
  daleth: 8504,
  darr: 8595,
  Darr: 8609,
  dArr: 8659,
  dash: 8208,
  Dashv: 10980,
  dashv: 8867,
  dbkarow: 10511,
  dblac: 733,
  Dcaron: 270,
  dcaron: 271,
  Dcy: 1044,
  dcy: 1076,
  ddagger: 8225,
  ddarr: 8650,
  DD: 8517,
  dd: 8518,
  DDotrahd: 10513,
  ddotseq: 10871,
  deg: 176,
  Del: 8711,
  Delta: 916,
  delta: 948,
  demptyv: 10673,
  dfisht: 10623,
  Dfr: 55349,
  dfr: 55349,
  dHar: 10597,
  dharl: 8643,
  dharr: 8642,
  DiacriticalAcute: 180,
  DiacriticalDot: 729,
  DiacriticalDoubleAcute: 733,
  DiacriticalGrave: 96,
  DiacriticalTilde: 732,
  diam: 8900,
  diamond: 8900,
  Diamond: 8900,
  diamondsuit: 9830,
  diams: 9830,
  die: 168,
  DifferentialD: 8518,
  digamma: 989,
  disin: 8946,
  div: 247,
  divide: 247,
  divideontimes: 8903,
  divonx: 8903,
  DJcy: 1026,
  djcy: 1106,
  dlcorn: 8990,
  dlcrop: 8973,
  dollar: 36,
  Dopf: 55349,
  dopf: 55349,
  Dot: 168,
  dot: 729,
  DotDot: 8412,
  doteq: 8784,
  doteqdot: 8785,
  DotEqual: 8784,
  dotminus: 8760,
  dotplus: 8724,
  dotsquare: 8865,
  doublebarwedge: 8966,
  DoubleContourIntegral: 8751,
  DoubleDot: 168,
  DoubleDownArrow: 8659,
  DoubleLeftArrow: 8656,
  DoubleLeftRightArrow: 8660,
  DoubleLeftTee: 10980,
  DoubleLongLeftArrow: 10232,
  DoubleLongLeftRightArrow: 10234,
  DoubleLongRightArrow: 10233,
  DoubleRightArrow: 8658,
  DoubleRightTee: 8872,
  DoubleUpArrow: 8657,
  DoubleUpDownArrow: 8661,
  DoubleVerticalBar: 8741,
  DownArrowBar: 10515,
  downarrow: 8595,
  DownArrow: 8595,
  Downarrow: 8659,
  DownArrowUpArrow: 8693,
  DownBreve: 785,
  downdownarrows: 8650,
  downharpoonleft: 8643,
  downharpoonright: 8642,
  DownLeftRightVector: 10576,
  DownLeftTeeVector: 10590,
  DownLeftVectorBar: 10582,
  DownLeftVector: 8637,
  DownRightTeeVector: 10591,
  DownRightVectorBar: 10583,
  DownRightVector: 8641,
  DownTeeArrow: 8615,
  DownTee: 8868,
  drbkarow: 10512,
  drcorn: 8991,
  drcrop: 8972,
  Dscr: 55349,
  dscr: 55349,
  DScy: 1029,
  dscy: 1109,
  dsol: 10742,
  Dstrok: 272,
  dstrok: 273,
  dtdot: 8945,
  dtri: 9663,
  dtrif: 9662,
  duarr: 8693,
  duhar: 10607,
  dwangle: 10662,
  DZcy: 1039,
  dzcy: 1119,
  dzigrarr: 10239,
  Eacute: 201,
  eacute: 233,
  easter: 10862,
  Ecaron: 282,
  ecaron: 283,
  Ecirc: 202,
  ecirc: 234,
  ecir: 8790,
  ecolon: 8789,
  Ecy: 1069,
  ecy: 1101,
  eDDot: 10871,
  Edot: 278,
  edot: 279,
  eDot: 8785,
  ee: 8519,
  efDot: 8786,
  Efr: 55349,
  efr: 55349,
  eg: 10906,
  Egrave: 200,
  egrave: 232,
  egs: 10902,
  egsdot: 10904,
  el: 10905,
  Element: 8712,
  elinters: 9191,
  ell: 8467,
  els: 10901,
  elsdot: 10903,
  Emacr: 274,
  emacr: 275,
  empty: 8709,
  emptyset: 8709,
  EmptySmallSquare: 9723,
  emptyv: 8709,
  EmptyVerySmallSquare: 9643,
  emsp13: 8196,
  emsp14: 8197,
  emsp: 8195,
  ENG: 330,
  eng: 331,
  ensp: 8194,
  Eogon: 280,
  eogon: 281,
  Eopf: 55349,
  eopf: 55349,
  epar: 8917,
  eparsl: 10723,
  eplus: 10865,
  epsi: 949,
  Epsilon: 917,
  epsilon: 949,
  epsiv: 1013,
  eqcirc: 8790,
  eqcolon: 8789,
  eqsim: 8770,
  eqslantgtr: 10902,
  eqslantless: 10901,
  Equal: 10869,
  equals: 61,
  EqualTilde: 8770,
  equest: 8799,
  Equilibrium: 8652,
  equiv: 8801,
  equivDD: 10872,
  eqvparsl: 10725,
  erarr: 10609,
  erDot: 8787,
  escr: 8495,
  Escr: 8496,
  esdot: 8784,
  Esim: 10867,
  esim: 8770,
  Eta: 919,
  eta: 951,
  ETH: 208,
  eth: 240,
  Euml: 203,
  euml: 235,
  euro: 8364,
  excl: 33,
  exist: 8707,
  Exists: 8707,
  expectation: 8496,
  exponentiale: 8519,
  ExponentialE: 8519,
  fallingdotseq: 8786,
  Fcy: 1060,
  fcy: 1092,
  female: 9792,
  ffilig: 64259,
  fflig: 64256,
  ffllig: 64260,
  Ffr: 55349,
  ffr: 55349,
  filig: 64257,
  FilledSmallSquare: 9724,
  FilledVerySmallSquare: 9642,
  fjlig: 102,
  flat: 9837,
  fllig: 64258,
  fltns: 9649,
  fnof: 402,
  Fopf: 55349,
  fopf: 55349,
  forall: 8704,
  ForAll: 8704,
  fork: 8916,
  forkv: 10969,
  Fouriertrf: 8497,
  fpartint: 10765,
  frac12: 189,
  frac13: 8531,
  frac14: 188,
  frac15: 8533,
  frac16: 8537,
  frac18: 8539,
  frac23: 8532,
  frac25: 8534,
  frac34: 190,
  frac35: 8535,
  frac38: 8540,
  frac45: 8536,
  frac56: 8538,
  frac58: 8541,
  frac78: 8542,
  frasl: 8260,
  frown: 8994,
  fscr: 55349,
  Fscr: 8497,
  gacute: 501,
  Gamma: 915,
  gamma: 947,
  Gammad: 988,
  gammad: 989,
  gap: 10886,
  Gbreve: 286,
  gbreve: 287,
  Gcedil: 290,
  Gcirc: 284,
  gcirc: 285,
  Gcy: 1043,
  gcy: 1075,
  Gdot: 288,
  gdot: 289,
  ge: 8805,
  gE: 8807,
  gEl: 10892,
  gel: 8923,
  geq: 8805,
  geqq: 8807,
  geqslant: 10878,
  gescc: 10921,
  ges: 10878,
  gesdot: 10880,
  gesdoto: 10882,
  gesdotol: 10884,
  gesl: 8923,
  gesles: 10900,
  Gfr: 55349,
  gfr: 55349,
  gg: 8811,
  Gg: 8921,
  ggg: 8921,
  gimel: 8503,
  GJcy: 1027,
  gjcy: 1107,
  gla: 10917,
  gl: 8823,
  glE: 10898,
  glj: 10916,
  gnap: 10890,
  gnapprox: 10890,
  gne: 10888,
  gnE: 8809,
  gneq: 10888,
  gneqq: 8809,
  gnsim: 8935,
  Gopf: 55349,
  gopf: 55349,
  grave: 96,
  GreaterEqual: 8805,
  GreaterEqualLess: 8923,
  GreaterFullEqual: 8807,
  GreaterGreater: 10914,
  GreaterLess: 8823,
  GreaterSlantEqual: 10878,
  GreaterTilde: 8819,
  Gscr: 55349,
  gscr: 8458,
  gsim: 8819,
  gsime: 10894,
  gsiml: 10896,
  gtcc: 10919,
  gtcir: 10874,
  gt: 62,
  GT: 62,
  Gt: 8811,
  gtdot: 8919,
  gtlPar: 10645,
  gtquest: 10876,
  gtrapprox: 10886,
  gtrarr: 10616,
  gtrdot: 8919,
  gtreqless: 8923,
  gtreqqless: 10892,
  gtrless: 8823,
  gtrsim: 8819,
  gvertneqq: 8809,
  gvnE: 8809,
  Hacek: 711,
  hairsp: 8202,
  half: 189,
  hamilt: 8459,
  HARDcy: 1066,
  hardcy: 1098,
  harrcir: 10568,
  harr: 8596,
  hArr: 8660,
  harrw: 8621,
  Hat: 94,
  hbar: 8463,
  Hcirc: 292,
  hcirc: 293,
  hearts: 9829,
  heartsuit: 9829,
  hellip: 8230,
  hercon: 8889,
  hfr: 55349,
  Hfr: 8460,
  HilbertSpace: 8459,
  hksearow: 10533,
  hkswarow: 10534,
  hoarr: 8703,
  homtht: 8763,
  hookleftarrow: 8617,
  hookrightarrow: 8618,
  hopf: 55349,
  Hopf: 8461,
  horbar: 8213,
  HorizontalLine: 9472,
  hscr: 55349,
  Hscr: 8459,
  hslash: 8463,
  Hstrok: 294,
  hstrok: 295,
  HumpDownHump: 8782,
  HumpEqual: 8783,
  hybull: 8259,
  hyphen: 8208,
  Iacute: 205,
  iacute: 237,
  ic: 8291,
  Icirc: 206,
  icirc: 238,
  Icy: 1048,
  icy: 1080,
  Idot: 304,
  IEcy: 1045,
  iecy: 1077,
  iexcl: 161,
  iff: 8660,
  ifr: 55349,
  Ifr: 8465,
  Igrave: 204,
  igrave: 236,
  ii: 8520,
  iiiint: 10764,
  iiint: 8749,
  iinfin: 10716,
  iiota: 8489,
  IJlig: 306,
  ijlig: 307,
  Imacr: 298,
  imacr: 299,
  image: 8465,
  ImaginaryI: 8520,
  imagline: 8464,
  imagpart: 8465,
  imath: 305,
  Im: 8465,
  imof: 8887,
  imped: 437,
  Implies: 8658,
  incare: 8453,
  'in': 8712,
  infin: 8734,
  infintie: 10717,
  inodot: 305,
  intcal: 8890,
  int: 8747,
  Int: 8748,
  integers: 8484,
  Integral: 8747,
  intercal: 8890,
  Intersection: 8898,
  intlarhk: 10775,
  intprod: 10812,
  InvisibleComma: 8291,
  InvisibleTimes: 8290,
  IOcy: 1025,
  iocy: 1105,
  Iogon: 302,
  iogon: 303,
  Iopf: 55349,
  iopf: 55349,
  Iota: 921,
  iota: 953,
  iprod: 10812,
  iquest: 191,
  iscr: 55349,
  Iscr: 8464,
  isin: 8712,
  isindot: 8949,
  isinE: 8953,
  isins: 8948,
  isinsv: 8947,
  isinv: 8712,
  it: 8290,
  Itilde: 296,
  itilde: 297,
  Iukcy: 1030,
  iukcy: 1110,
  Iuml: 207,
  iuml: 239,
  Jcirc: 308,
  jcirc: 309,
  Jcy: 1049,
  jcy: 1081,
  Jfr: 55349,
  jfr: 55349,
  jmath: 567,
  Jopf: 55349,
  jopf: 55349,
  Jscr: 55349,
  jscr: 55349,
  Jsercy: 1032,
  jsercy: 1112,
  Jukcy: 1028,
  jukcy: 1108,
  Kappa: 922,
  kappa: 954,
  kappav: 1008,
  Kcedil: 310,
  kcedil: 311,
  Kcy: 1050,
  kcy: 1082,
  Kfr: 55349,
  kfr: 55349,
  kgreen: 312,
  KHcy: 1061,
  khcy: 1093,
  KJcy: 1036,
  kjcy: 1116,
  Kopf: 55349,
  kopf: 55349,
  Kscr: 55349,
  kscr: 55349,
  lAarr: 8666,
  Lacute: 313,
  lacute: 314,
  laemptyv: 10676,
  lagran: 8466,
  Lambda: 923,
  lambda: 955,
  lang: 10216,
  Lang: 10218,
  langd: 10641,
  langle: 10216,
  lap: 10885,
  Laplacetrf: 8466,
  laquo: 171,
  larrb: 8676,
  larrbfs: 10527,
  larr: 8592,
  Larr: 8606,
  lArr: 8656,
  larrfs: 10525,
  larrhk: 8617,
  larrlp: 8619,
  larrpl: 10553,
  larrsim: 10611,
  larrtl: 8610,
  latail: 10521,
  lAtail: 10523,
  lat: 10923,
  late: 10925,
  lates: 10925,
  lbarr: 10508,
  lBarr: 10510,
  lbbrk: 10098,
  lbrace: 123,
  lbrack: 91,
  lbrke: 10635,
  lbrksld: 10639,
  lbrkslu: 10637,
  Lcaron: 317,
  lcaron: 318,
  Lcedil: 315,
  lcedil: 316,
  lceil: 8968,
  lcub: 123,
  Lcy: 1051,
  lcy: 1083,
  ldca: 10550,
  ldquo: 8220,
  ldquor: 8222,
  ldrdhar: 10599,
  ldrushar: 10571,
  ldsh: 8626,
  le: 8804,
  lE: 8806,
  LeftAngleBracket: 10216,
  LeftArrowBar: 8676,
  leftarrow: 8592,
  LeftArrow: 8592,
  Leftarrow: 8656,
  LeftArrowRightArrow: 8646,
  leftarrowtail: 8610,
  LeftCeiling: 8968,
  LeftDoubleBracket: 10214,
  LeftDownTeeVector: 10593,
  LeftDownVectorBar: 10585,
  LeftDownVector: 8643,
  LeftFloor: 8970,
  leftharpoondown: 8637,
  leftharpoonup: 8636,
  leftleftarrows: 8647,
  leftrightarrow: 8596,
  LeftRightArrow: 8596,
  Leftrightarrow: 8660,
  leftrightarrows: 8646,
  leftrightharpoons: 8651,
  leftrightsquigarrow: 8621,
  LeftRightVector: 10574,
  LeftTeeArrow: 8612,
  LeftTee: 8867,
  LeftTeeVector: 10586,
  leftthreetimes: 8907,
  LeftTriangleBar: 10703,
  LeftTriangle: 8882,
  LeftTriangleEqual: 8884,
  LeftUpDownVector: 10577,
  LeftUpTeeVector: 10592,
  LeftUpVectorBar: 10584,
  LeftUpVector: 8639,
  LeftVectorBar: 10578,
  LeftVector: 8636,
  lEg: 10891,
  leg: 8922,
  leq: 8804,
  leqq: 8806,
  leqslant: 10877,
  lescc: 10920,
  les: 10877,
  lesdot: 10879,
  lesdoto: 10881,
  lesdotor: 10883,
  lesg: 8922,
  lesges: 10899,
  lessapprox: 10885,
  lessdot: 8918,
  lesseqgtr: 8922,
  lesseqqgtr: 10891,
  LessEqualGreater: 8922,
  LessFullEqual: 8806,
  LessGreater: 8822,
  lessgtr: 8822,
  LessLess: 10913,
  lesssim: 8818,
  LessSlantEqual: 10877,
  LessTilde: 8818,
  lfisht: 10620,
  lfloor: 8970,
  Lfr: 55349,
  lfr: 55349,
  lg: 8822,
  lgE: 10897,
  lHar: 10594,
  lhard: 8637,
  lharu: 8636,
  lharul: 10602,
  lhblk: 9604,
  LJcy: 1033,
  ljcy: 1113,
  llarr: 8647,
  ll: 8810,
  Ll: 8920,
  llcorner: 8990,
  Lleftarrow: 8666,
  llhard: 10603,
  lltri: 9722,
  Lmidot: 319,
  lmidot: 320,
  lmoustache: 9136,
  lmoust: 9136,
  lnap: 10889,
  lnapprox: 10889,
  lne: 10887,
  lnE: 8808,
  lneq: 10887,
  lneqq: 8808,
  lnsim: 8934,
  loang: 10220,
  loarr: 8701,
  lobrk: 10214,
  longleftarrow: 10229,
  LongLeftArrow: 10229,
  Longleftarrow: 10232,
  longleftrightarrow: 10231,
  LongLeftRightArrow: 10231,
  Longleftrightarrow: 10234,
  longmapsto: 10236,
  longrightarrow: 10230,
  LongRightArrow: 10230,
  Longrightarrow: 10233,
  looparrowleft: 8619,
  looparrowright: 8620,
  lopar: 10629,
  Lopf: 55349,
  lopf: 55349,
  loplus: 10797,
  lotimes: 10804,
  lowast: 8727,
  lowbar: 95,
  LowerLeftArrow: 8601,
  LowerRightArrow: 8600,
  loz: 9674,
  lozenge: 9674,
  lozf: 10731,
  lpar: 40,
  lparlt: 10643,
  lrarr: 8646,
  lrcorner: 8991,
  lrhar: 8651,
  lrhard: 10605,
  lrm: 8206,
  lrtri: 8895,
  lsaquo: 8249,
  lscr: 55349,
  Lscr: 8466,
  lsh: 8624,
  Lsh: 8624,
  lsim: 8818,
  lsime: 10893,
  lsimg: 10895,
  lsqb: 91,
  lsquo: 8216,
  lsquor: 8218,
  Lstrok: 321,
  lstrok: 322,
  ltcc: 10918,
  ltcir: 10873,
  lt: 60,
  LT: 60,
  Lt: 8810,
  ltdot: 8918,
  lthree: 8907,
  ltimes: 8905,
  ltlarr: 10614,
  ltquest: 10875,
  ltri: 9667,
  ltrie: 8884,
  ltrif: 9666,
  ltrPar: 10646,
  lurdshar: 10570,
  luruhar: 10598,
  lvertneqq: 8808,
  lvnE: 8808,
  macr: 175,
  male: 9794,
  malt: 10016,
  maltese: 10016,
  Map: 10501,
  map: 8614,
  mapsto: 8614,
  mapstodown: 8615,
  mapstoleft: 8612,
  mapstoup: 8613,
  marker: 9646,
  mcomma: 10793,
  Mcy: 1052,
  mcy: 1084,
  mdash: 8212,
  mDDot: 8762,
  measuredangle: 8737,
  MediumSpace: 8287,
  Mellintrf: 8499,
  Mfr: 55349,
  mfr: 55349,
  mho: 8487,
  micro: 181,
  midast: 42,
  midcir: 10992,
  mid: 8739,
  middot: 183,
  minusb: 8863,
  minus: 8722,
  minusd: 8760,
  minusdu: 10794,
  MinusPlus: 8723,
  mlcp: 10971,
  mldr: 8230,
  mnplus: 8723,
  models: 8871,
  Mopf: 55349,
  mopf: 55349,
  mp: 8723,
  mscr: 55349,
  Mscr: 8499,
  mstpos: 8766,
  Mu: 924,
  mu: 956,
  multimap: 8888,
  mumap: 8888,
  nabla: 8711,
  Nacute: 323,
  nacute: 324,
  nang: 8736,
  nap: 8777,
  napE: 10864,
  napid: 8779,
  napos: 329,
  napprox: 8777,
  natural: 9838,
  naturals: 8469,
  natur: 9838,
  nbsp: 160,
  nbump: 8782,
  nbumpe: 8783,
  ncap: 10819,
  Ncaron: 327,
  ncaron: 328,
  Ncedil: 325,
  ncedil: 326,
  ncong: 8775,
  ncongdot: 10861,
  ncup: 10818,
  Ncy: 1053,
  ncy: 1085,
  ndash: 8211,
  nearhk: 10532,
  nearr: 8599,
  neArr: 8663,
  nearrow: 8599,
  ne: 8800,
  nedot: 8784,
  NegativeMediumSpace: 8203,
  NegativeThickSpace: 8203,
  NegativeThinSpace: 8203,
  NegativeVeryThinSpace: 8203,
  nequiv: 8802,
  nesear: 10536,
  nesim: 8770,
  NestedGreaterGreater: 8811,
  NestedLessLess: 8810,
  NewLine: 10,
  nexist: 8708,
  nexists: 8708,
  Nfr: 55349,
  nfr: 55349,
  ngE: 8807,
  nge: 8817,
  ngeq: 8817,
  ngeqq: 8807,
  ngeqslant: 10878,
  nges: 10878,
  nGg: 8921,
  ngsim: 8821,
  nGt: 8811,
  ngt: 8815,
  ngtr: 8815,
  nGtv: 8811,
  nharr: 8622,
  nhArr: 8654,
  nhpar: 10994,
  ni: 8715,
  nis: 8956,
  nisd: 8954,
  niv: 8715,
  NJcy: 1034,
  njcy: 1114,
  nlarr: 8602,
  nlArr: 8653,
  nldr: 8229,
  nlE: 8806,
  nle: 8816,
  nleftarrow: 8602,
  nLeftarrow: 8653,
  nleftrightarrow: 8622,
  nLeftrightarrow: 8654,
  nleq: 8816,
  nleqq: 8806,
  nleqslant: 10877,
  nles: 10877,
  nless: 8814,
  nLl: 8920,
  nlsim: 8820,
  nLt: 8810,
  nlt: 8814,
  nltri: 8938,
  nltrie: 8940,
  nLtv: 8810,
  nmid: 8740,
  NoBreak: 8288,
  NonBreakingSpace: 160,
  nopf: 55349,
  Nopf: 8469,
  Not: 10988,
  not: 172,
  NotCongruent: 8802,
  NotCupCap: 8813,
  NotDoubleVerticalBar: 8742,
  NotElement: 8713,
  NotEqual: 8800,
  NotEqualTilde: 8770,
  NotExists: 8708,
  NotGreater: 8815,
  NotGreaterEqual: 8817,
  NotGreaterFullEqual: 8807,
  NotGreaterGreater: 8811,
  NotGreaterLess: 8825,
  NotGreaterSlantEqual: 10878,
  NotGreaterTilde: 8821,
  NotHumpDownHump: 8782,
  NotHumpEqual: 8783,
  notin: 8713,
  notindot: 8949,
  notinE: 8953,
  notinva: 8713,
  notinvb: 8951,
  notinvc: 8950,
  NotLeftTriangleBar: 10703,
  NotLeftTriangle: 8938,
  NotLeftTriangleEqual: 8940,
  NotLess: 8814,
  NotLessEqual: 8816,
  NotLessGreater: 8824,
  NotLessLess: 8810,
  NotLessSlantEqual: 10877,
  NotLessTilde: 8820,
  NotNestedGreaterGreater: 10914,
  NotNestedLessLess: 10913,
  notni: 8716,
  notniva: 8716,
  notnivb: 8958,
  notnivc: 8957,
  NotPrecedes: 8832,
  NotPrecedesEqual: 10927,
  NotPrecedesSlantEqual: 8928,
  NotReverseElement: 8716,
  NotRightTriangleBar: 10704,
  NotRightTriangle: 8939,
  NotRightTriangleEqual: 8941,
  NotSquareSubset: 8847,
  NotSquareSubsetEqual: 8930,
  NotSquareSuperset: 8848,
  NotSquareSupersetEqual: 8931,
  NotSubset: 8834,
  NotSubsetEqual: 8840,
  NotSucceeds: 8833,
  NotSucceedsEqual: 10928,
  NotSucceedsSlantEqual: 8929,
  NotSucceedsTilde: 8831,
  NotSuperset: 8835,
  NotSupersetEqual: 8841,
  NotTilde: 8769,
  NotTildeEqual: 8772,
  NotTildeFullEqual: 8775,
  NotTildeTilde: 8777,
  NotVerticalBar: 8740,
  nparallel: 8742,
  npar: 8742,
  nparsl: 11005,
  npart: 8706,
  npolint: 10772,
  npr: 8832,
  nprcue: 8928,
  nprec: 8832,
  npreceq: 10927,
  npre: 10927,
  nrarrc: 10547,
  nrarr: 8603,
  nrArr: 8655,
  nrarrw: 8605,
  nrightarrow: 8603,
  nRightarrow: 8655,
  nrtri: 8939,
  nrtrie: 8941,
  nsc: 8833,
  nsccue: 8929,
  nsce: 10928,
  Nscr: 55349,
  nscr: 55349,
  nshortmid: 8740,
  nshortparallel: 8742,
  nsim: 8769,
  nsime: 8772,
  nsimeq: 8772,
  nsmid: 8740,
  nspar: 8742,
  nsqsube: 8930,
  nsqsupe: 8931,
  nsub: 8836,
  nsubE: 10949,
  nsube: 8840,
  nsubset: 8834,
  nsubseteq: 8840,
  nsubseteqq: 10949,
  nsucc: 8833,
  nsucceq: 10928,
  nsup: 8837,
  nsupE: 10950,
  nsupe: 8841,
  nsupset: 8835,
  nsupseteq: 8841,
  nsupseteqq: 10950,
  ntgl: 8825,
  Ntilde: 209,
  ntilde: 241,
  ntlg: 8824,
  ntriangleleft: 8938,
  ntrianglelefteq: 8940,
  ntriangleright: 8939,
  ntrianglerighteq: 8941,
  Nu: 925,
  nu: 957,
  num: 35,
  numero: 8470,
  numsp: 8199,
  nvap: 8781,
  nvdash: 8876,
  nvDash: 8877,
  nVdash: 8878,
  nVDash: 8879,
  nvge: 8805,
  nvgt: 62,
  nvHarr: 10500,
  nvinfin: 10718,
  nvlArr: 10498,
  nvle: 8804,
  nvlt: 62,
  nvltrie: 8884,
  nvrArr: 10499,
  nvrtrie: 8885,
  nvsim: 8764,
  nwarhk: 10531,
  nwarr: 8598,
  nwArr: 8662,
  nwarrow: 8598,
  nwnear: 10535,
  Oacute: 211,
  oacute: 243,
  oast: 8859,
  Ocirc: 212,
  ocirc: 244,
  ocir: 8858,
  Ocy: 1054,
  ocy: 1086,
  odash: 8861,
  Odblac: 336,
  odblac: 337,
  odiv: 10808,
  odot: 8857,
  odsold: 10684,
  OElig: 338,
  oelig: 339,
  ofcir: 10687,
  Ofr: 55349,
  ofr: 55349,
  ogon: 731,
  Ograve: 210,
  ograve: 242,
  ogt: 10689,
  ohbar: 10677,
  ohm: 937,
  oint: 8750,
  olarr: 8634,
  olcir: 10686,
  olcross: 10683,
  oline: 8254,
  olt: 10688,
  Omacr: 332,
  omacr: 333,
  Omega: 937,
  omega: 969,
  Omicron: 927,
  omicron: 959,
  omid: 10678,
  ominus: 8854,
  Oopf: 55349,
  oopf: 55349,
  opar: 10679,
  OpenCurlyDoubleQuote: 8220,
  OpenCurlyQuote: 8216,
  operp: 10681,
  oplus: 8853,
  orarr: 8635,
  Or: 10836,
  or: 8744,
  ord: 10845,
  order: 8500,
  orderof: 8500,
  ordf: 170,
  ordm: 186,
  origof: 8886,
  oror: 10838,
  orslope: 10839,
  orv: 10843,
  oS: 9416,
  Oscr: 55349,
  oscr: 8500,
  Oslash: 216,
  oslash: 248,
  osol: 8856,
  Otilde: 213,
  otilde: 245,
  otimesas: 10806,
  Otimes: 10807,
  otimes: 8855,
  Ouml: 214,
  ouml: 246,
  ovbar: 9021,
  OverBar: 8254,
  OverBrace: 9182,
  OverBracket: 9140,
  OverParenthesis: 9180,
  para: 182,
  parallel: 8741,
  par: 8741,
  parsim: 10995,
  parsl: 11005,
  part: 8706,
  PartialD: 8706,
  Pcy: 1055,
  pcy: 1087,
  percnt: 37,
  period: 46,
  permil: 8240,
  perp: 8869,
  pertenk: 8241,
  Pfr: 55349,
  pfr: 55349,
  Phi: 934,
  phi: 966,
  phiv: 981,
  phmmat: 8499,
  phone: 9742,
  Pi: 928,
  pi: 960,
  pitchfork: 8916,
  piv: 982,
  planck: 8463,
  planckh: 8462,
  plankv: 8463,
  plusacir: 10787,
  plusb: 8862,
  pluscir: 10786,
  plus: 43,
  plusdo: 8724,
  plusdu: 10789,
  pluse: 10866,
  PlusMinus: 177,
  plusmn: 177,
  plussim: 10790,
  plustwo: 10791,
  pm: 177,
  Poincareplane: 8460,
  pointint: 10773,
  popf: 55349,
  Popf: 8473,
  pound: 163,
  prap: 10935,
  Pr: 10939,
  pr: 8826,
  prcue: 8828,
  precapprox: 10935,
  prec: 8826,
  preccurlyeq: 8828,
  Precedes: 8826,
  PrecedesEqual: 10927,
  PrecedesSlantEqual: 8828,
  PrecedesTilde: 8830,
  preceq: 10927,
  precnapprox: 10937,
  precneqq: 10933,
  precnsim: 8936,
  pre: 10927,
  prE: 10931,
  precsim: 8830,
  prime: 8242,
  Prime: 8243,
  primes: 8473,
  prnap: 10937,
  prnE: 10933,
  prnsim: 8936,
  prod: 8719,
  Product: 8719,
  profalar: 9006,
  profline: 8978,
  profsurf: 8979,
  prop: 8733,
  Proportional: 8733,
  Proportion: 8759,
  propto: 8733,
  prsim: 8830,
  prurel: 8880,
  Pscr: 55349,
  pscr: 55349,
  Psi: 936,
  psi: 968,
  puncsp: 8200,
  Qfr: 55349,
  qfr: 55349,
  qint: 10764,
  qopf: 55349,
  Qopf: 8474,
  qprime: 8279,
  Qscr: 55349,
  qscr: 55349,
  quaternions: 8461,
  quatint: 10774,
  quest: 63,
  questeq: 8799,
  quot: 34,
  QUOT: 34,
  rAarr: 8667,
  race: 8765,
  Racute: 340,
  racute: 341,
  radic: 8730,
  raemptyv: 10675,
  rang: 10217,
  Rang: 10219,
  rangd: 10642,
  range: 10661,
  rangle: 10217,
  raquo: 187,
  rarrap: 10613,
  rarrb: 8677,
  rarrbfs: 10528,
  rarrc: 10547,
  rarr: 8594,
  Rarr: 8608,
  rArr: 8658,
  rarrfs: 10526,
  rarrhk: 8618,
  rarrlp: 8620,
  rarrpl: 10565,
  rarrsim: 10612,
  Rarrtl: 10518,
  rarrtl: 8611,
  rarrw: 8605,
  ratail: 10522,
  rAtail: 10524,
  ratio: 8758,
  rationals: 8474,
  rbarr: 10509,
  rBarr: 10511,
  RBarr: 10512,
  rbbrk: 10099,
  rbrace: 125,
  rbrack: 93,
  rbrke: 10636,
  rbrksld: 10638,
  rbrkslu: 10640,
  Rcaron: 344,
  rcaron: 345,
  Rcedil: 342,
  rcedil: 343,
  rceil: 8969,
  rcub: 125,
  Rcy: 1056,
  rcy: 1088,
  rdca: 10551,
  rdldhar: 10601,
  rdquo: 8221,
  rdquor: 8221,
  rdsh: 8627,
  real: 8476,
  realine: 8475,
  realpart: 8476,
  reals: 8477,
  Re: 8476,
  rect: 9645,
  reg: 174,
  REG: 174,
  ReverseElement: 8715,
  ReverseEquilibrium: 8651,
  ReverseUpEquilibrium: 10607,
  rfisht: 10621,
  rfloor: 8971,
  rfr: 55349,
  Rfr: 8476,
  rHar: 10596,
  rhard: 8641,
  rharu: 8640,
  rharul: 10604,
  Rho: 929,
  rho: 961,
  rhov: 1009,
  RightAngleBracket: 10217,
  RightArrowBar: 8677,
  rightarrow: 8594,
  RightArrow: 8594,
  Rightarrow: 8658,
  RightArrowLeftArrow: 8644,
  rightarrowtail: 8611,
  RightCeiling: 8969,
  RightDoubleBracket: 10215,
  RightDownTeeVector: 10589,
  RightDownVectorBar: 10581,
  RightDownVector: 8642,
  RightFloor: 8971,
  rightharpoondown: 8641,
  rightharpoonup: 8640,
  rightleftarrows: 8644,
  rightleftharpoons: 8652,
  rightrightarrows: 8649,
  rightsquigarrow: 8605,
  RightTeeArrow: 8614,
  RightTee: 8866,
  RightTeeVector: 10587,
  rightthreetimes: 8908,
  RightTriangleBar: 10704,
  RightTriangle: 8883,
  RightTriangleEqual: 8885,
  RightUpDownVector: 10575,
  RightUpTeeVector: 10588,
  RightUpVectorBar: 10580,
  RightUpVector: 8638,
  RightVectorBar: 10579,
  RightVector: 8640,
  ring: 730,
  risingdotseq: 8787,
  rlarr: 8644,
  rlhar: 8652,
  rlm: 8207,
  rmoustache: 9137,
  rmoust: 9137,
  rnmid: 10990,
  roang: 10221,
  roarr: 8702,
  robrk: 10215,
  ropar: 10630,
  ropf: 55349,
  Ropf: 8477,
  roplus: 10798,
  rotimes: 10805,
  RoundImplies: 10608,
  rpar: 41,
  rpargt: 10644,
  rppolint: 10770,
  rrarr: 8649,
  Rrightarrow: 8667,
  rsaquo: 8250,
  rscr: 55349,
  Rscr: 8475,
  rsh: 8625,
  Rsh: 8625,
  rsqb: 93,
  rsquo: 8217,
  rsquor: 8217,
  rthree: 8908,
  rtimes: 8906,
  rtri: 9657,
  rtrie: 8885,
  rtrif: 9656,
  rtriltri: 10702,
  RuleDelayed: 10740,
  ruluhar: 10600,
  rx: 8478,
  Sacute: 346,
  sacute: 347,
  sbquo: 8218,
  scap: 10936,
  Scaron: 352,
  scaron: 353,
  Sc: 10940,
  sc: 8827,
  sccue: 8829,
  sce: 10928,
  scE: 10932,
  Scedil: 350,
  scedil: 351,
  Scirc: 348,
  scirc: 349,
  scnap: 10938,
  scnE: 10934,
  scnsim: 8937,
  scpolint: 10771,
  scsim: 8831,
  Scy: 1057,
  scy: 1089,
  sdotb: 8865,
  sdot: 8901,
  sdote: 10854,
  searhk: 10533,
  searr: 8600,
  seArr: 8664,
  searrow: 8600,
  sect: 167,
  semi: 59,
  seswar: 10537,
  setminus: 8726,
  setmn: 8726,
  sext: 10038,
  Sfr: 55349,
  sfr: 55349,
  sfrown: 8994,
  sharp: 9839,
  SHCHcy: 1065,
  shchcy: 1097,
  SHcy: 1064,
  shcy: 1096,
  ShortDownArrow: 8595,
  ShortLeftArrow: 8592,
  shortmid: 8739,
  shortparallel: 8741,
  ShortRightArrow: 8594,
  ShortUpArrow: 8593,
  shy: 173,
  Sigma: 931,
  sigma: 963,
  sigmaf: 962,
  sigmav: 962,
  sim: 8764,
  simdot: 10858,
  sime: 8771,
  simeq: 8771,
  simg: 10910,
  simgE: 10912,
  siml: 10909,
  simlE: 10911,
  simne: 8774,
  simplus: 10788,
  simrarr: 10610,
  slarr: 8592,
  SmallCircle: 8728,
  smallsetminus: 8726,
  smashp: 10803,
  smeparsl: 10724,
  smid: 8739,
  smile: 8995,
  smt: 10922,
  smte: 10924,
  smtes: 10924,
  SOFTcy: 1068,
  softcy: 1100,
  solbar: 9023,
  solb: 10692,
  sol: 47,
  Sopf: 55349,
  sopf: 55349,
  spades: 9824,
  spadesuit: 9824,
  spar: 8741,
  sqcap: 8851,
  sqcaps: 8851,
  sqcup: 8852,
  sqcups: 8852,
  Sqrt: 8730,
  sqsub: 8847,
  sqsube: 8849,
  sqsubset: 8847,
  sqsubseteq: 8849,
  sqsup: 8848,
  sqsupe: 8850,
  sqsupset: 8848,
  sqsupseteq: 8850,
  square: 9633,
  Square: 9633,
  SquareIntersection: 8851,
  SquareSubset: 8847,
  SquareSubsetEqual: 8849,
  SquareSuperset: 8848,
  SquareSupersetEqual: 8850,
  SquareUnion: 8852,
  squarf: 9642,
  squ: 9633,
  squf: 9642,
  srarr: 8594,
  Sscr: 55349,
  sscr: 55349,
  ssetmn: 8726,
  ssmile: 8995,
  sstarf: 8902,
  Star: 8902,
  star: 9734,
  starf: 9733,
  straightepsilon: 1013,
  straightphi: 981,
  strns: 175,
  sub: 8834,
  Sub: 8912,
  subdot: 10941,
  subE: 10949,
  sube: 8838,
  subedot: 10947,
  submult: 10945,
  subnE: 10955,
  subne: 8842,
  subplus: 10943,
  subrarr: 10617,
  subset: 8834,
  Subset: 8912,
  subseteq: 8838,
  subseteqq: 10949,
  SubsetEqual: 8838,
  subsetneq: 8842,
  subsetneqq: 10955,
  subsim: 10951,
  subsub: 10965,
  subsup: 10963,
  succapprox: 10936,
  succ: 8827,
  succcurlyeq: 8829,
  Succeeds: 8827,
  SucceedsEqual: 10928,
  SucceedsSlantEqual: 8829,
  SucceedsTilde: 8831,
  succeq: 10928,
  succnapprox: 10938,
  succneqq: 10934,
  succnsim: 8937,
  succsim: 8831,
  SuchThat: 8715,
  sum: 8721,
  Sum: 8721,
  sung: 9834,
  sup1: 185,
  sup2: 178,
  sup3: 179,
  sup: 8835,
  Sup: 8913,
  supdot: 10942,
  supdsub: 10968,
  supE: 10950,
  supe: 8839,
  supedot: 10948,
  Superset: 8835,
  SupersetEqual: 8839,
  suphsol: 10185,
  suphsub: 10967,
  suplarr: 10619,
  supmult: 10946,
  supnE: 10956,
  supne: 8843,
  supplus: 10944,
  supset: 8835,
  Supset: 8913,
  supseteq: 8839,
  supseteqq: 10950,
  supsetneq: 8843,
  supsetneqq: 10956,
  supsim: 10952,
  supsub: 10964,
  supsup: 10966,
  swarhk: 10534,
  swarr: 8601,
  swArr: 8665,
  swarrow: 8601,
  swnwar: 10538,
  szlig: 223,
  Tab: NaN,
  target: 8982,
  Tau: 932,
  tau: 964,
  tbrk: 9140,
  Tcaron: 356,
  tcaron: 357,
  Tcedil: 354,
  tcedil: 355,
  Tcy: 1058,
  tcy: 1090,
  tdot: 8411,
  telrec: 8981,
  Tfr: 55349,
  tfr: 55349,
  there4: 8756,
  therefore: 8756,
  Therefore: 8756,
  Theta: 920,
  theta: 952,
  thetasym: 977,
  thetav: 977,
  thickapprox: 8776,
  thicksim: 8764,
  ThickSpace: 8287,
  ThinSpace: 8201,
  thinsp: 8201,
  thkap: 8776,
  thksim: 8764,
  THORN: 222,
  thorn: 254,
  tilde: 732,
  Tilde: 8764,
  TildeEqual: 8771,
  TildeFullEqual: 8773,
  TildeTilde: 8776,
  timesbar: 10801,
  timesb: 8864,
  times: 215,
  timesd: 10800,
  tint: 8749,
  toea: 10536,
  topbot: 9014,
  topcir: 10993,
  top: 8868,
  Topf: 55349,
  topf: 55349,
  topfork: 10970,
  tosa: 10537,
  tprime: 8244,
  trade: 8482,
  TRADE: 8482,
  triangle: 9653,
  triangledown: 9663,
  triangleleft: 9667,
  trianglelefteq: 8884,
  triangleq: 8796,
  triangleright: 9657,
  trianglerighteq: 8885,
  tridot: 9708,
  trie: 8796,
  triminus: 10810,
  TripleDot: 8411,
  triplus: 10809,
  trisb: 10701,
  tritime: 10811,
  trpezium: 9186,
  Tscr: 55349,
  tscr: 55349,
  TScy: 1062,
  tscy: 1094,
  TSHcy: 1035,
  tshcy: 1115,
  Tstrok: 358,
  tstrok: 359,
  twixt: 8812,
  twoheadleftarrow: 8606,
  twoheadrightarrow: 8608,
  Uacute: 218,
  uacute: 250,
  uarr: 8593,
  Uarr: 8607,
  uArr: 8657,
  Uarrocir: 10569,
  Ubrcy: 1038,
  ubrcy: 1118,
  Ubreve: 364,
  ubreve: 365,
  Ucirc: 219,
  ucirc: 251,
  Ucy: 1059,
  ucy: 1091,
  udarr: 8645,
  Udblac: 368,
  udblac: 369,
  udhar: 10606,
  ufisht: 10622,
  Ufr: 55349,
  ufr: 55349,
  Ugrave: 217,
  ugrave: 249,
  uHar: 10595,
  uharl: 8639,
  uharr: 8638,
  uhblk: 9600,
  ulcorn: 8988,
  ulcorner: 8988,
  ulcrop: 8975,
  ultri: 9720,
  Umacr: 362,
  umacr: 363,
  uml: 168,
  UnderBar: 95,
  UnderBrace: 9183,
  UnderBracket: 9141,
  UnderParenthesis: 9181,
  Union: 8899,
  UnionPlus: 8846,
  Uogon: 370,
  uogon: 371,
  Uopf: 55349,
  uopf: 55349,
  UpArrowBar: 10514,
  uparrow: 8593,
  UpArrow: 8593,
  Uparrow: 8657,
  UpArrowDownArrow: 8645,
  updownarrow: 8597,
  UpDownArrow: 8597,
  Updownarrow: 8661,
  UpEquilibrium: 10606,
  upharpoonleft: 8639,
  upharpoonright: 8638,
  uplus: 8846,
  UpperLeftArrow: 8598,
  UpperRightArrow: 8599,
  upsi: 965,
  Upsi: 978,
  upsih: 978,
  Upsilon: 933,
  upsilon: 965,
  UpTeeArrow: 8613,
  UpTee: 8869,
  upuparrows: 8648,
  urcorn: 8989,
  urcorner: 8989,
  urcrop: 8974,
  Uring: 366,
  uring: 367,
  urtri: 9721,
  Uscr: 55349,
  uscr: 55349,
  utdot: 8944,
  Utilde: 360,
  utilde: 361,
  utri: 9653,
  utrif: 9652,
  uuarr: 8648,
  Uuml: 220,
  uuml: 252,
  uwangle: 10663,
  vangrt: 10652,
  varepsilon: 1013,
  varkappa: 1008,
  varnothing: 8709,
  varphi: 981,
  varpi: 982,
  varpropto: 8733,
  varr: 8597,
  vArr: 8661,
  varrho: 1009,
  varsigma: 962,
  varsubsetneq: 8842,
  varsubsetneqq: 10955,
  varsupsetneq: 8843,
  varsupsetneqq: 10956,
  vartheta: 977,
  vartriangleleft: 8882,
  vartriangleright: 8883,
  vBar: 10984,
  Vbar: 10987,
  vBarv: 10985,
  Vcy: 1042,
  vcy: 1074,
  vdash: 8866,
  vDash: 8872,
  Vdash: 8873,
  VDash: 8875,
  Vdashl: 10982,
  veebar: 8891,
  vee: 8744,
  Vee: 8897,
  veeeq: 8794,
  vellip: 8942,
  verbar: 124,
  Verbar: 8214,
  vert: 124,
  Vert: 8214,
  VerticalBar: 8739,
  VerticalLine: 124,
  VerticalSeparator: 10072,
  VerticalTilde: 8768,
  VeryThinSpace: 8202,
  Vfr: 55349,
  vfr: 55349,
  vltri: 8882,
  vnsub: 8834,
  vnsup: 8835,
  Vopf: 55349,
  vopf: 55349,
  vprop: 8733,
  vrtri: 8883,
  Vscr: 55349,
  vscr: 55349,
  vsubnE: 10955,
  vsubne: 8842,
  vsupnE: 10956,
  vsupne: 8843,
  Vvdash: 8874,
  vzigzag: 10650,
  Wcirc: 372,
  wcirc: 373,
  wedbar: 10847,
  wedge: 8743,
  Wedge: 8896,
  wedgeq: 8793,
  weierp: 8472,
  Wfr: 55349,
  wfr: 55349,
  Wopf: 55349,
  wopf: 55349,
  wp: 8472,
  wr: 8768,
  wreath: 8768,
  Wscr: 55349,
  wscr: 55349,
  xcap: 8898,
  xcirc: 9711,
  xcup: 8899,
  xdtri: 9661,
  Xfr: 55349,
  xfr: 55349,
  xharr: 10231,
  xhArr: 10234,
  Xi: 926,
  xi: 958,
  xlarr: 10229,
  xlArr: 10232,
  xmap: 10236,
  xnis: 8955,
  xodot: 10752,
  Xopf: 55349,
  xopf: 55349,
  xoplus: 10753,
  xotime: 10754,
  xrarr: 10230,
  xrArr: 10233,
  Xscr: 55349,
  xscr: 55349,
  xsqcup: 10758,
  xuplus: 10756,
  xutri: 9651,
  xvee: 8897,
  xwedge: 8896,
  Yacute: 221,
  yacute: 253,
  YAcy: 1071,
  yacy: 1103,
  Ycirc: 374,
  ycirc: 375,
  Ycy: 1067,
  ycy: 1099,
  yen: 165,
  Yfr: 55349,
  yfr: 55349,
  YIcy: 1031,
  yicy: 1111,
  Yopf: 55349,
  yopf: 55349,
  Yscr: 55349,
  yscr: 55349,
  YUcy: 1070,
  yucy: 1102,
  yuml: 255,
  Yuml: 376,
  Zacute: 377,
  zacute: 378,
  Zcaron: 381,
  zcaron: 382,
  Zcy: 1047,
  zcy: 1079,
  Zdot: 379,
  zdot: 380,
  zeetrf: 8488,
  ZeroWidthSpace: 8203,
  Zeta: 918,
  zeta: 950,
  zfr: 55349,
  Zfr: 8488,
  ZHcy: 1046,
  zhcy: 1078,
  zigrarr: 8669,
  zopf: 55349,
  Zopf: 8484,
  Zscr: 55349,
  zscr: 55349,
  zwj: 8205,
  zwnj: 8204 };

var entityToChar = function(m) {
    var isNumeric = /^&#/.test(m);
    var isHex = /^&#[Xx]/.test(m);
    var uchar;
    var ucode;
    if (isNumeric) {
        var num;
        if (isHex) {
            num = parseInt(m.slice(3, -1), 16);
        } else {
            num = parseInt(m.slice(2, -1), 10);
        }
        uchar = fromCodePoint(num);
    } else {
        ucode = entities[m.slice(1, -1)];
        if (ucode) {
            uchar = fromCodePoint(entities[m.slice(1, -1)]);
        }
    }
    return (uchar || m);
};

module.exports.entityToChar = entityToChar;

},{"./from-code-point":3}],6:[function(require,module,exports){
"use strict";

// commonmark.js - CommomMark in JavaScript
// Copyright (C) 2014 John MacFarlane
// License: BSD3.

// Basic usage:
//
// var commonmark = require('commonmark');
// var parser = new commonmark.DocParser();
// var renderer = new commonmark.HtmlRenderer();
// console.log(renderer.render(parser.parse('Hello *world*')));

module.exports.Node = require('./node');
module.exports.DocParser = require('./blocks');
module.exports.HtmlRenderer = require('./html');
module.exports.XmlRenderer = require('./xml');

},{"./blocks":1,"./html":4,"./node":8,"./xml":9}],7:[function(require,module,exports){
"use strict";

var Node = require('./node');
var common = require('./common');
var normalizeURI = common.normalizeURI;
var unescapeString = common.unescapeString;
var fromCodePoint = require('./from-code-point.js');
var entityToChar = require('./html5-entities.js').entityToChar;

// Constants for character codes:

var C_NEWLINE = 10;
var C_ASTERISK = 42;
var C_UNDERSCORE = 95;
var C_BACKTICK = 96;
var C_OPEN_BRACKET = 91;
var C_CLOSE_BRACKET = 93;
var C_LESSTHAN = 60;
var C_BANG = 33;
var C_BACKSLASH = 92;
var C_AMPERSAND = 38;
var C_OPEN_PAREN = 40;
var C_COLON = 58;

// Some regexps used in inline parser:

var ESCAPABLE = '[!"#$%&\'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]';
var ESCAPED_CHAR = '\\\\' + ESCAPABLE;
var REG_CHAR = '[^\\\\()\\x00-\\x20]';
var IN_PARENS_NOSP = '\\((' + REG_CHAR + '|' + ESCAPED_CHAR + ')*\\)';
var TAGNAME = '[A-Za-z][A-Za-z0-9]*';
var ATTRIBUTENAME = '[a-zA-Z_:][a-zA-Z0-9:._-]*';
var UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+";
var SINGLEQUOTEDVALUE = "'[^']*'";
var DOUBLEQUOTEDVALUE = '"[^"]*"';
var ATTRIBUTEVALUE = "(?:" + UNQUOTEDVALUE + "|" + SINGLEQUOTEDVALUE + "|" + DOUBLEQUOTEDVALUE + ")";
var ATTRIBUTEVALUESPEC = "(?:" + "\\s*=" + "\\s*" + ATTRIBUTEVALUE + ")";
var ATTRIBUTE = "(?:" + "\\s+" + ATTRIBUTENAME + ATTRIBUTEVALUESPEC + "?)";
var OPENTAG = "<" + TAGNAME + ATTRIBUTE + "*" + "\\s*/?>";
var CLOSETAG = "</" + TAGNAME + "\\s*[>]";
var HTMLCOMMENT = "<!---->|<!--(?:-?[^>-])(?:-?[^-])*-->";
var PROCESSINGINSTRUCTION = "[<][?].*?[?][>]";
var DECLARATION = "<![A-Z]+" + "\\s+[^>]*>";
var CDATA = "<!\\[CDATA\\[[\\s\\S]*?\]\\]>";
var HTMLTAG = "(?:" + OPENTAG + "|" + CLOSETAG + "|" + HTMLCOMMENT + "|" +
        PROCESSINGINSTRUCTION + "|" + DECLARATION + "|" + CDATA + ")";
var ENTITY = "&(?:#x[a-f0-9]{1,8}|#[0-9]{1,8}|[a-z][a-z0-9]{1,31});";

var rePunctuation = new RegExp(/^[\u2000-\u206F\u2E00-\u2E7F\\'!"#\$%&\(\)\*\+,\-\.\/:;<=>\?@\[\]\^_`\{\|\}~]/);

var reHtmlTag = new RegExp('^' + HTMLTAG, 'i');

var reLinkTitle = new RegExp(
    '^(?:"(' + ESCAPED_CHAR + '|[^"\\x00])*"' +
        '|' +
        '\'(' + ESCAPED_CHAR + '|[^\'\\x00])*\'' +
        '|' +
        '\\((' + ESCAPED_CHAR + '|[^)\\x00])*\\))');

var reLinkDestinationBraces = new RegExp(
    '^(?:[<](?:[^<>\\n\\\\\\x00]' + '|' + ESCAPED_CHAR + '|' + '\\\\)*[>])');

var reLinkDestination = new RegExp(
    '^(?:' + REG_CHAR + '+|' + ESCAPED_CHAR + '|' + IN_PARENS_NOSP + ')*');

var reEscapable = new RegExp(ESCAPABLE);

var reEntityHere = new RegExp('^' + ENTITY, 'i');

var reTicks = new RegExp('`+');

var reTicksHere = new RegExp('^`+');

var reEmailAutolink = /^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;

var reAutolink = /^<(?:coap|doi|javascript|aaa|aaas|about|acap|cap|cid|crid|data|dav|dict|dns|file|ftp|geo|go|gopher|h323|http|https|iax|icap|im|imap|info|ipp|iris|iris.beep|iris.xpc|iris.xpcs|iris.lwz|ldap|mailto|mid|msrp|msrps|mtqp|mupdate|news|nfs|ni|nih|nntp|opaquelocktoken|pop|pres|rtsp|service|session|shttp|sieve|sip|sips|sms|snmp|soap.beep|soap.beeps|tag|tel|telnet|tftp|thismessage|tn3270|tip|tv|urn|vemmi|ws|wss|xcon|xcon-userid|xmlrpc.beep|xmlrpc.beeps|xmpp|z39.50r|z39.50s|adiumxtra|afp|afs|aim|apt|attachment|aw|beshare|bitcoin|bolo|callto|chrome|chrome-extension|com-eventbrite-attendee|content|cvs|dlna-playsingle|dlna-playcontainer|dtn|dvb|ed2k|facetime|feed|finger|fish|gg|git|gizmoproject|gtalk|hcp|icon|ipn|irc|irc6|ircs|itms|jar|jms|keyparc|lastfm|ldaps|magnet|maps|market|message|mms|ms-help|msnim|mumble|mvn|notes|oid|palm|paparazzi|platform|proxy|psyc|query|res|resource|rmi|rsync|rtmp|secondlife|sftp|sgn|skype|smb|soldat|spotify|ssh|steam|svn|teamspeak|things|udp|unreal|ut2004|ventrilo|view-source|webcal|wtai|wyciwyg|xfire|xri|ymsgr):[^<>\x00-\x20]*>/i;

var reSpnl = /^ *(?:\n *)?/;

var reWhitespaceChar = /^\s/;

var reWhitespace = /\s+/g;

var reFinalSpace = / *$/;

var reInitialSpace = /^ */;

var reAsciiAlnum = /[a-z0-9]/i;

var reLinkLabel = /^\[(?:[^\\\[\]]|\\[\[\]]){0,1000}\]/;

// Matches a string of non-special characters.
var reMain = /^[^\n`\[\]\\!<&*_]+/m;

// Normalize reference label: collapse internal whitespace
// to single space, remove leading/trailing whitespace, case fold.
var normalizeReference = function(s) {
    return s.trim()
        .replace(/\s+/, ' ')
        .toUpperCase();
};

var text = function(s) {
    var node = new Node('Text');
    node.literal = s;
    return node;
};

// INLINE PARSER

// These are methods of an InlineParser object, defined below.
// An InlineParser keeps track of a subject (a string to be
// parsed) and a position in that subject.

// If re matches at current position in the subject, advance
// position in subject and return the match; otherwise return null.
var match = function(re) {
    var m = re.exec(this.subject.slice(this.pos));
    if (m) {
        this.pos += m.index + m[0].length;
        return m[0];
    } else {
        return null;
    }
};

// Returns the code for the character at the current subject position, or -1
// there are no more characters.
var peek = function() {
    if (this.pos < this.subject.length) {
        return this.subject.charCodeAt(this.pos);
    } else {
        return -1;
    }
};

// Parse zero or more space characters, including at most one newline
var spnl = function() {
    this.match(reSpnl);
    return 1;
};

// All of the parsers below try to match something at the current position
// in the subject.  If they succeed in matching anything, they
// return the inline matched, advancing the subject.

// Attempt to parse backticks, adding either a backtick code span or a
// literal sequence of backticks.
var parseBackticks = function(block) {
    var ticks = this.match(reTicksHere);
    if (!ticks) {
        return 0;
    }
    var afterOpenTicks = this.pos;
    var foundCode = false;
    var matched;
    var node;
    while (!foundCode && (matched = this.match(reTicks))) {
        if (matched === ticks) {
            node = new Node('Code');
            node.literal = this.subject.slice(afterOpenTicks,
                                        this.pos - ticks.length)
                          .trim().replace(reWhitespace, ' ');
            block.appendChild(node);
            return true;
        }
    }
    // If we got here, we didn't match a closing backtick sequence.
    this.pos = afterOpenTicks;
    block.appendChild(text(ticks));
    return true;
};

// Parse a backslash-escaped special character, adding either the escaped
// character, a hard line break (if the backslash is followed by a newline),
// or a literal backslash to the block's children.
var parseBackslash = function(block) {
    var subj = this.subject,
        pos = this.pos;
    var node;
    if (subj.charCodeAt(pos) === C_BACKSLASH) {
        if (subj.charAt(pos + 1) === '\n') {
            this.pos = this.pos + 2;
            node = new Node('Hardbreak');
            block.appendChild(node);
        } else if (reEscapable.test(subj.charAt(pos + 1))) {
            this.pos = this.pos + 2;
            block.appendChild(text(subj.charAt(pos + 1)));
        } else {
            this.pos++;
            block.appendChild(text('\\'));
        }
        return true;
    } else {
        return false;
    }
};

// Attempt to parse an autolink (URL or email in pointy brackets).
var parseAutolink = function(block) {
    var m;
    var dest;
    var node;
    if ((m = this.match(reEmailAutolink))) {
        dest = m.slice(1, -1);
        node = new Node('Link');
        node.destination = normalizeURI('mailto:' + dest);
        node.title = '';
        node.appendChild(text(dest));
        block.appendChild(node);
        return true;
    } else if ((m = this.match(reAutolink))) {
        dest = m.slice(1, -1);
        node = new Node('Link');
        node.destination = normalizeURI(dest);
        node.title = '';
        node.appendChild(text(dest));
        block.appendChild(node);
        return true;
    } else {
        return false;
    }
};

// Attempt to parse a raw HTML tag.
var parseHtmlTag = function(block) {
    var m = this.match(reHtmlTag);
    var node;
    if (m) {
        node = new Node('Html');
        node.literal = m;
        block.appendChild(node);
        return true;
    } else {
        return false;
    }
};

// Scan a sequence of characters with code cc, and return information about
// the number of delimiters and whether they are positioned such that
// they can open and/or close emphasis or strong emphasis.  A utility
// function for strong/emph parsing.
var scanDelims = function(cc) {
    var numdelims = 0;
    var char_before, char_after, cc_after;
    var startpos = this.pos;

    char_before = this.pos === 0 ? '\n' :
        this.subject.charAt(this.pos - 1);

    while (this.peek() === cc) {
        numdelims++;
        this.pos++;
    }

    cc_after = this.peek();
    if (cc_after === -1) {
        char_after = '\n';
    } else {
        char_after = fromCodePoint(cc_after);
    }

    var can_open = numdelims > 0 && !(reWhitespaceChar.test(char_after)) &&
            !(rePunctuation.test(char_after) &&
             !(/\s/.test(char_before)) &&
             !(rePunctuation.test(char_before)));
    var can_close = numdelims > 0 && !(reWhitespaceChar.test(char_before)) &&
            !(rePunctuation.test(char_before) &&
              !(reWhitespaceChar.test(char_after)) &&
              !(rePunctuation.test(char_after)));
    if (cc === C_UNDERSCORE) {
        can_open = can_open && !((reAsciiAlnum).test(char_before));
        can_close = can_close && !((reAsciiAlnum).test(char_after));
    }
    this.pos = startpos;
    return { numdelims: numdelims,
             can_open: can_open,
             can_close: can_close };
};

// Attempt to parse emphasis or strong emphasis.
var parseEmphasis = function(cc, block) {
    var res = this.scanDelims(cc);
    var numdelims = res.numdelims;
    var startpos = this.pos;

    if (numdelims === 0) {
        return false;
    }

    this.pos += numdelims;
    var node = text(this.subject.slice(startpos, this.pos));
    block.appendChild(node);

    // Add entry to stack for this opener
    this.delimiters = { cc: cc,
                        numdelims: numdelims,
                        node: node,
                        previous: this.delimiters,
                        next: null,
                        can_open: res.can_open,
                        can_close: res.can_close,
                        active: true };
    if (this.delimiters.previous !== null) {
        this.delimiters.previous.next = this.delimiters;
    }

    return true;

};

var removeDelimiter = function(delim) {
    if (delim.previous !== null) {
        delim.previous.next = delim.next;
    }
    if (delim.next === null) {
        // top of stack
        this.delimiters = delim.previous;
    } else {
        delim.next.previous = delim.previous;
    }
};

var processEmphasis = function(block, stack_bottom) {
    var opener, closer;
    var opener_inl, closer_inl;
    var nextstack, tempstack;
    var use_delims;
    var tmp, next;

    // find first closer above stack_bottom:
    closer = this.delimiters;
    while (closer !== null && closer.previous !== stack_bottom) {
        closer = closer.previous;
    }
    // move forward, looking for closers, and handling each
    while (closer !== null) {
        if (closer.can_close && (closer.cc === C_UNDERSCORE || closer.cc === C_ASTERISK)) {
            // found emphasis closer. now look back for first matching opener:
            opener = closer.previous;
            while (opener !== null && opener !== stack_bottom) {
                if (opener.cc === closer.cc && opener.can_open) {
                    break;
                }
                opener = opener.previous;
            }
            if (opener !== null && opener !== stack_bottom) {
                // calculate actual number of delimiters used from this closer
                if (closer.numdelims < 3 || opener.numdelims < 3) {
                    use_delims = closer.numdelims <= opener.numdelims ?
                        closer.numdelims : opener.numdelims;
                } else {
                    use_delims = closer.numdelims % 2 === 0 ? 2 : 1;
                }

                opener_inl = opener.node;
                closer_inl = closer.node;

                // remove used delimiters from stack elts and inlines
                opener.numdelims -= use_delims;
                closer.numdelims -= use_delims;
                opener_inl.literal =
                    opener_inl.literal.slice(0,
                                     opener_inl.literal.length - use_delims);
                closer_inl.literal =
                    closer_inl.literal.slice(0,
                                     closer_inl.literal.length - use_delims);

                // build contents for new emph element
                var emph = new Node(use_delims === 1 ? 'Emph' : 'Strong');

                tmp = opener_inl.next;
                while (tmp && tmp !== closer_inl) {
                    next = tmp.next;
                    tmp.unlink();
                    emph.appendChild(tmp);
                    tmp = next;
                }

                opener_inl.insertAfter(emph);

                // remove elts btw opener and closer in delimiters stack
                tempstack = closer.previous;
                while (tempstack !== null && tempstack !== opener) {
                    nextstack = tempstack.previous;
                    this.removeDelimiter(tempstack);
                    tempstack = nextstack;
                }

                // if opener has 0 delims, remove it and the inline
                if (opener.numdelims === 0) {
                    opener_inl.unlink();
                    this.removeDelimiter(opener);
                }

                if (closer.numdelims === 0) {
                    closer_inl.unlink();
                    tempstack = closer.next;
                    this.removeDelimiter(closer);
                    closer = tempstack;
                }

            } else {
                closer = closer.next;
            }

        } else {
            closer = closer.next;
        }

    }

    // remove all delimiters
    while (this.delimiters !== stack_bottom) {
        this.removeDelimiter(this.delimiters);
    }
};

// Attempt to parse link title (sans quotes), returning the string
// or null if no match.
var parseLinkTitle = function() {
    var title = this.match(reLinkTitle);
    if (title) {
        // chop off quotes from title and unescape:
        return unescapeString(title.substr(1, title.length - 2));
    } else {
        return null;
    }
};

// Attempt to parse link destination, returning the string or
// null if no match.
var parseLinkDestination = function() {
    var res = this.match(reLinkDestinationBraces);
    if (res) {  // chop off surrounding <..>:
        return normalizeURI(unescapeString(res.substr(1, res.length - 2)));
    } else {
        res = this.match(reLinkDestination);
        if (res !== null) {
            return normalizeURI(unescapeString(res));
        } else {
            return null;
        }
    }
};

// Attempt to parse a link label, returning number of characters parsed.
var parseLinkLabel = function() {
    var m = this.match(reLinkLabel);
    return m === null ? 0 : m.length;
};

// Add open bracket to delimiter stack and add a text node to block's children.
var parseOpenBracket = function(block) {
    var startpos = this.pos;
    this.pos += 1;

    var node = text('[');
    block.appendChild(node);

    // Add entry to stack for this opener
    this.delimiters = { cc: C_OPEN_BRACKET,
                        numdelims: 1,
                        node: node,
                        previous: this.delimiters,
                        next: null,
                        can_open: true,
                        can_close: false,
                        index: startpos,
                        active: true };
    if (this.delimiters.previous !== null) {
        this.delimiters.previous.next = this.delimiters;
    }

    return true;

};

// IF next character is [, and ! delimiter to delimiter stack and
// add a text node to block's children.  Otherwise just add a text node.
var parseBang = function(block) {
    var startpos = this.pos;
    this.pos += 1;
    if (this.peek() === C_OPEN_BRACKET) {
        this.pos += 1;

        var node = text('![');
        block.appendChild(node);

        // Add entry to stack for this opener
        this.delimiters = { cc: C_BANG,
                            numdelims: 1,
                            node: node,
                            previous: this.delimiters,
                            next: null,
                            can_open: true,
                            can_close: false,
                            index: startpos + 1,
                            active: true };
        if (this.delimiters.previous !== null) {
            this.delimiters.previous.next = this.delimiters;
        }
    } else {
        block.appendChild(text('!'));
    }
    return true;
};

// Try to match close bracket against an opening in the delimiter
// stack.  Add either a link or image, or a plain [ character,
// to block's children.  If there is a matching delimiter,
// remove it from the delimiter stack.
var parseCloseBracket = function(block) {
    var startpos;
    var is_image;
    var dest;
    var title;
    var matched = false;
    var reflabel;
    var opener;

    this.pos += 1;
    startpos = this.pos;

    // look through stack of delimiters for a [ or ![
    opener = this.delimiters;

    while (opener !== null) {
        if (opener.cc === C_OPEN_BRACKET || opener.cc === C_BANG) {
            break;
        }
        opener = opener.previous;
    }

    if (opener === null) {
        // no matched opener, just return a literal
        block.appendChild(text(']'));
        return true;
    }

    if (!opener.active) {
        // no matched opener, just return a literal
        block.appendChild(text(']'));
        // take opener off emphasis stack
        this.removeDelimiter(opener);
        return true;
    }

    // If we got here, open is a potential opener
    is_image = opener.cc === C_BANG;

    // Check to see if we have a link/image

    // Inline link?
    if (this.peek() === C_OPEN_PAREN) {
        this.pos++;
        if (this.spnl() &&
            ((dest = this.parseLinkDestination()) !== null) &&
            this.spnl() &&
            // make sure there's a space before the title:
            (reWhitespaceChar.test(this.subject.charAt(this.pos - 1)) &&
             (title = this.parseLinkTitle()) || true) &&
            this.spnl() &&
            this.subject.charAt(this.pos) === ')') {
            this.pos += 1;
            matched = true;
        }
    } else {

        // Next, see if there's a link label
        var savepos = this.pos;
        this.spnl();
        var beforelabel = this.pos;
        var n = this.parseLinkLabel();
        if (n === 0 || n === 2) {
            // empty or missing second label
            reflabel = this.subject.slice(opener.index, startpos);
        } else {
            reflabel = this.subject.slice(beforelabel, beforelabel + n);
        }
        if (n === 0) {
            // If shortcut reference link, rewind before spaces we skipped.
            this.pos = savepos;
        }

        // lookup rawlabel in refmap
        var link = this.refmap[normalizeReference(reflabel)];
        if (link) {
            dest = link.destination;
            title = link.title;
            matched = true;
        }
    }

    if (matched) {
        var node = new Node(is_image ? 'Image' : 'Link');
        node.destination = dest;
        node.title = title || '';

        var tmp, next;
        tmp = opener.node.next;
        while (tmp) {
            next = tmp.next;
            tmp.unlink();
            node.appendChild(tmp);
            tmp = next;
        }
        block.appendChild(node);
        this.processEmphasis(node, opener.previous);

        opener.node.unlink();

        // processEmphasis will remove this and later delimiters.
        // Now, for a link, we also deactivate earlier link openers.
        // (no links in links)
        if (!is_image) {
          opener = this.delimiters;
          while (opener !== null) {
            if (opener.cc === C_OPEN_BRACKET) {
                opener.active = false; // deactivate this opener
            }
            opener = opener.previous;
          }
        }

        return true;

    } else { // no match

        this.removeDelimiter(opener);  // remove this opener from stack
        this.pos = startpos;
        block.appendChild(text(']'));
        return true;
    }

};

// Attempt to parse an entity, return Entity object if successful.
var parseEntity = function(block) {
    var m;
    if ((m = this.match(reEntityHere))) {
        block.appendChild(text(entityToChar(m)));
        return true;
    } else {
        return false;
    }
};

// Parse a run of ordinary characters, or a single character with
// a special meaning in markdown, as a plain string.
var parseString = function(block) {
    var m;
    if ((m = this.match(reMain))) {
        block.appendChild(text(m));
        return true;
    } else {
        return false;
    }
};

// Parse a newline.  If it was preceded by two spaces, return a hard
// line break; otherwise a soft line break.
var parseNewline = function(block) {
    this.pos += 1; // assume we're at a \n
    // check previous node for trailing spaces
    var lastc = block.lastChild;
    if (lastc && lastc.t === 'Text') {
        var sps = reFinalSpace.exec(lastc.literal)[0].length;
        if (sps > 0) {
            lastc.literal = lastc.literal.replace(reFinalSpace, '');
        }
        block.appendChild(new Node(sps >= 2 ? 'Hardbreak' : 'Softbreak'));
    } else {
        block.appendChild(new Node('Softbreak'));
    }
    this.match(reInitialSpace); // gobble leading spaces in next line
    return true;
};

// Attempt to parse a link reference, modifying refmap.
var parseReference = function(s, refmap) {
    this.subject = s;
    this.pos = 0;
    var rawlabel;
    var dest;
    var title;
    var matchChars;
    var startpos = this.pos;

    // label:
    matchChars = this.parseLinkLabel();
    if (matchChars === 0) {
        return 0;
    } else {
        rawlabel = this.subject.substr(0, matchChars);
    }

    // colon:
    if (this.peek() === C_COLON) {
        this.pos++;
    } else {
        this.pos = startpos;
        return 0;
    }

    //  link url
    this.spnl();

    dest = this.parseLinkDestination();
    if (dest === null || dest.length === 0) {
        this.pos = startpos;
        return 0;
    }

    var beforetitle = this.pos;
    this.spnl();
    title = this.parseLinkTitle();
    if (title === null) {
        title = '';
        // rewind before spaces
        this.pos = beforetitle;
    }

    // make sure we're at line end:
    if (this.match(/^ *(?:\n|$)/) === null) {
        this.pos = startpos;
        return 0;
    }

    var normlabel = normalizeReference(rawlabel);

    if (!refmap[normlabel]) {
        refmap[normlabel] = { destination: dest, title: title };
    }
    return this.pos - startpos;
};

// Parse the next inline element in subject, advancing subject position.
// On success, add the result to block's children and return true.
// On failure, return false.
var parseInline = function(block) {
    var res;
    var c = this.peek();
    if (c === -1) {
        return false;
    }
    switch(c) {
    case C_NEWLINE:
        res = this.parseNewline(block);
        break;
    case C_BACKSLASH:
        res = this.parseBackslash(block);
        break;
    case C_BACKTICK:
        res = this.parseBackticks(block);
        break;
    case C_ASTERISK:
    case C_UNDERSCORE:
        res = this.parseEmphasis(c, block);
        break;
    case C_OPEN_BRACKET:
        res = this.parseOpenBracket(block);
        break;
    case C_BANG:
        res = this.parseBang(block);
        break;
    case C_CLOSE_BRACKET:
        res = this.parseCloseBracket(block);
        break;
    case C_LESSTHAN:
        res = this.parseAutolink(block) || this.parseHtmlTag(block);
        break;
    case C_AMPERSAND:
        res = this.parseEntity(block);
        break;
    default:
        res = this.parseString(block);
        break;
    }
    if (!res) {
        this.pos += 1;
        var textnode = new Node('Text');
        textnode.literal = fromCodePoint(c);
        block.appendChild(textnode);
    }

    return true;
};

// Parse string_content in block into inline children,
// using refmap to resolve references.
var parseInlines = function(block, refmap) {
    this.subject = block.string_content.trim();
    this.pos = 0;
    this.refmap = refmap || {};
    this.delimiters = null;
    while (this.parseInline(block)) {
    }
    this.processEmphasis(block, null);
};

// The InlineParser object.
function InlineParser(){
    return {
        subject: '',
        delimiters: null,  // used by parseEmphasis method
        pos: 0,
        refmap: {},
        match: match,
        peek: peek,
        spnl: spnl,
        parseBackticks: parseBackticks,
        parseBackslash: parseBackslash,
        parseAutolink: parseAutolink,
        parseHtmlTag: parseHtmlTag,
        scanDelims: scanDelims,
        parseEmphasis: parseEmphasis,
        parseLinkTitle: parseLinkTitle,
        parseLinkDestination: parseLinkDestination,
        parseLinkLabel: parseLinkLabel,
        parseOpenBracket: parseOpenBracket,
        parseCloseBracket: parseCloseBracket,
        parseBang: parseBang,
        parseEntity: parseEntity,
        parseString: parseString,
        parseNewline: parseNewline,
        parseReference: parseReference,
        parseInline: parseInline,
        processEmphasis: processEmphasis,
        removeDelimiter: removeDelimiter,
        parse: parseInlines
    };
}

module.exports = InlineParser;

},{"./common":2,"./from-code-point.js":3,"./html5-entities.js":5,"./node":8}],8:[function(require,module,exports){
"use strict";

function isContainer(node) {
    switch (node.t) {
    case 'Document':
    case 'BlockQuote':
    case 'List':
    case 'Item':
    case 'Paragraph':
    case 'Header':
    case 'Emph':
    case 'Strong':
    case 'Link':
    case 'Image':
        return true;
    default:
        return false;
    }
}

var resumeAt = function(node, entering) {
    this.current = node;
    this.entering = (entering === true);
};

var next = function(){
    var cur = this.current;
    var entering = this.entering;

    if (cur === null) {
        return null;
    }

    var container = isContainer(cur);

    if (entering && container) {
        if (cur.firstChild) {
            this.current = cur.firstChild;
            this.entering = true;
        } else {
            // stay on node but exit
            this.entering = false;
        }

    } else if (cur.next === null) {
        this.current = cur.parent;
        this.entering = false;

    } else {
        this.current = cur.next;
        this.entering = true;
    }

    return {entering: entering, node: cur};
};

var NodeWalker = function(root) {
    return { current: root,
             root: root,
             entering: true,
             next: next,
             resumeAt: resumeAt };
};

var Node = function(nodeType, sourcepos) {
    this.t = nodeType;
    this.parent = null;
    this.firstChild = null;
    this.lastChild = null;
    this.prev = null;
    this.next = null;
    this.sourcepos = sourcepos;
    this.last_line_blank = false;
    this.open = true;
    this.strings = null;
    this.string_content = null;
    this.literal = null;
    this.list_data = null;
    this.info = null;
    this.destination = null;
    this.title = null;
    this.fence_char = null;
    this.fence_length = null;
    this.fence_offset = null;
    this.level = null;
};

Node.prototype.isContainer = function() {
    return isContainer(this);
};

Node.prototype.appendChild = function(child) {
    child.unlink();
    child.parent = this;
    if (this.lastChild) {
        this.lastChild.next = child;
        child.prev = this.lastChild;
        this.lastChild = child;
    } else {
        this.firstChild = child;
        this.lastChild = child;
    }
};

Node.prototype.prependChild = function(child) {
    child.unlink();
    child.parent = this;
    if (this.firstChild) {
        this.firstChild.prev = child;
        child.next = this.firstChild;
        this.firstChild = child;
    } else {
        this.firstChild = child;
        this.lastChild = child;
    }
};

Node.prototype.unlink = function() {
    if (this.prev) {
        this.prev.next = this.next;
    } else if (this.parent) {
        this.parent.firstChild = this.next;
    }
    if (this.next) {
        this.next.prev = this.prev;
    } else if (this.parent) {
        this.parent.lastChild = this.prev;
    }
    this.parent = null;
    this.next = null;
    this.prev = null;
};

Node.prototype.insertAfter = function(sibling) {
    sibling.unlink();
    sibling.next = this.next;
    if (sibling.next) {
        sibling.next.prev = sibling;
    }
    sibling.prev = this;
    this.next = sibling;
    sibling.parent = this.parent;
    if (!sibling.next) {
        sibling.parent.lastChild = sibling;
    }
};

Node.prototype.insertBefore = function(sibling) {
    sibling.unlink();
    sibling.prev = this.prev;
    if (sibling.prev) {
        sibling.prev.next = sibling;
    }
    sibling.next = this;
    this.prev = sibling;
    sibling.parent = this.parent;
    if (!sibling.prev) {
        sibling.parent.firstChild = sibling;
    }
};

Node.prototype.walker = function() {
    var walker = new NodeWalker(this);
    return walker;
};

var nodeToObject = function(node) {
    var result = {};
    var propsToShow = ['t', 'literal', 'list_data', 'sourcepos',
                       'info', 'level', 'title', 'destination'];

    for (var i = 0, len = propsToShow.length; i < len; i++) {
        var prop = propsToShow[i];
        if (node[prop] !== undefined) {
            result[prop] = node[prop];
        }
    }
    return result;
};

Node.prototype.toObject = function() {
    var childrenStack = [];
    var walker = this.walker();
    var event;
    while ((event = walker.next())) {
        var node = event.node;
        var entering = event.entering;
        var container = node.isContainer();
        var astnode;

        if (container) {
            if (entering) {
                childrenStack.push([]);
            } else {
                astnode = nodeToObject(node);
                astnode.children = childrenStack.pop();
                if (childrenStack.length > 0) {
                    childrenStack[childrenStack.length - 1].push(astnode);
                }
            }
        } else {
            astnode = nodeToObject(node);
            childrenStack[childrenStack.length - 1].push(astnode);
        }
    }

    return astnode;

};

module.exports = Node;


/* Example of use of walker:

 var walker = w.walker();
 var event;

 while (event = walker.next()) {
 console.log(event.entering, event.node.t);
 }

 */

},{}],9:[function(require,module,exports){
"use strict";

var escapeXml = require('./common').escapeXml;

// Helper function to produce an XML tag.
var tag = function(name, attrs, selfclosing) {
    var result = '<' + name;
    if (attrs && attrs.length > 0) {
        var i = 0;
        var attrib;
        while ((attrib = attrs[i]) !== undefined) {
            result += ' ' + attrib[0] + '="' + attrib[1] + '"';
            i++;
        }
    }
    if (selfclosing) {
        result += ' /';
    }

    result += '>';
    return result;
};

var reXMLTag = /\<[^>]*\>/;

var toTagName = function(s) {
    return s.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
};

var renderNodes = function(block) {

    var attrs;
    var tagname;
    var walker = block.walker();
    var event, node, entering;
    var buffer = "";
    var lastOut = "\n";
    var disableTags = 0;
    var indentLevel = 0;
    var indent = '  ';
    var unescapedContents;
    var container;
    var selfClosing;
    var nodetype;

    var out = function(s) {
        if (disableTags > 0) {
            buffer += s.replace(reXMLTag, '');
        } else {
            buffer += s;
        }
        lastOut = s;
    };
    var esc = this.escape;
    var cr = function() {
        if (lastOut !== '\n') {
            buffer += '\n';
            lastOut = '\n';
            for (var i = indentLevel; i--;) {
                buffer += indent;
            }
        }
    };

    var options = this.options;

    if (options.time) { console.time("rendering"); }

    buffer += '<?xml version="1.0" encoding="UTF-8"?>\n';
    buffer += '<!DOCTYPE CommonMark SYSTEM "CommonMark.dtd">\n';

    while ((event = walker.next())) {
        entering = event.entering;
        node = event.node;
        nodetype = node.t;

        if (nodetype === 'ReferenceDef') {
            continue;
        }

        container = node.isContainer();
        selfClosing = nodetype === 'HorizontalRule' || nodetype === 'Hardbreak' ||
            nodetype === 'Softbreak' || nodetype === 'Image';
        unescapedContents = nodetype === 'Html' || nodetype === 'HtmlInline';
        tagname = toTagName(nodetype);

        if (entering) {

            attrs = [];

            switch (nodetype) {
            case 'List':
                var data = node.list_data;
                if (data.type !== null) {
                    attrs.push(['type', data.type.toLowerCase()]);
                }
                if (data.start !== null) {
                    attrs.push(['start', String(data.start)]);
                }
                if (data.tight !== null) {
                    attrs.push(['tight', (data.tight ? 'true' : 'false')]);
                }
                if (data.delimiter !== null) {
                    var delimword = '';
                    if (data.delimiter === '.') {
                        delimword = 'period';
                    } else {
                        delimword = 'paren';
                    }
                    attrs.push(['delimiter', delimword]);
                }
                break;
            case 'CodeBlock':
                if (node.info) {
                    attrs.push(['info', node.info]);
                }
                break;
            case 'Header':
                attrs.push(['level', String(node.level)]);
                break;
            case 'Link':
            case 'Image':
                attrs.push(['destination', node.destination]);
                attrs.push(['title', node.title]);
                break;
            default:
                break;
            }
            if (options.sourcepos) {
                var pos = node.sourcepos;
                if (pos) {
                    attrs.push(['data-sourcepos', String(pos[0][0]) + ':' +
                                String(pos[0][1]) + '-' + String(pos[1][0]) + ':' +
                                String(pos[1][1])]);
                }
            }

            cr();
            out(tag(tagname, attrs, selfClosing));
            if (container) {
                indentLevel += 1;
            } else if (!container && !selfClosing) {
                if (node.literal) {
                    out(unescapedContents ? node.literal : esc(node.literal));
                }
                out(tag('/' + tagname));
            }
        } else {
            indentLevel -= 1;
            cr();
            out(tag('/' + tagname));
        }


    }
    if (options.time) { console.timeEnd("rendering"); }
    buffer += '\n';
    return buffer;
};

// The XmlRenderer object.
function XmlRenderer(options){
    return {
        // default options:
        softbreak: '\n', // by default, soft breaks are rendered as newlines in HTML
        // set to "<br />" to make them hard breaks
        // set to " " if you want to ignore line wrapping in source
        escape: escapeXml,
        options: options || {},
        render: renderNodes
    };
}

module.exports = XmlRenderer;

},{"./common":2}]},{},[6])(6)
});