!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var o;"undefined"!=typeof window?o=window:"undefined"!=typeof global?o=global:"undefined"!=typeof self&&(o=self),o.commonmark=e()}}(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var C_GREATERTHAN = 62;
var C_SPACE = 32;
var C_OPEN_BRACKET = 91;

var InlineParser = require('./inlines');
var unescapeString = new InlineParser().unescapeString;

// Returns true if string contains only space characters.
var isBlank = function(s) {
    return /^\s*$/.test(s);
};

// Convert tabs to spaces on each line using a 4-space tab stop.
var detabLine = function(text) {
    if (text.indexOf('\t') == -1) {
        return text;
    } else {
        var lastStop = 0;
        return text.replace(/\t/g, function(match, offset) {
            var result = '    '.slice((offset - lastStop) % 4);
            lastStop = offset + 1;
            return result;
        });
    }
};

// Attempt to match a regex in string s at offset offset.
// Return index of match or -1.
var matchAt = function(re, s, offset) {
    var res = s.slice(offset).match(re);
    if (res) {
        return offset + res.index;
    } else {
        return -1;
    }
};

var BLOCKTAGNAME = '(?:article|header|aside|hgroup|iframe|blockquote|hr|body|li|map|button|object|canvas|ol|caption|output|col|p|colgroup|pre|dd|progress|div|section|dl|table|td|dt|tbody|embed|textarea|fieldset|tfoot|figcaption|th|figure|thead|footer|footer|tr|form|ul|h1|h2|h3|h4|h5|h6|video|script|style)';
var HTMLBLOCKOPEN = "<(?:" + BLOCKTAGNAME + "[\\s/>]" + "|" +
        "/" + BLOCKTAGNAME + "[\\s>]" + "|" + "[?!])";
var reHtmlBlockOpen = new RegExp('^' + HTMLBLOCKOPEN, 'i');

var reHrule = /^(?:(?:\* *){3,}|(?:_ *){3,}|(?:- *){3,}) *$/;


// DOC PARSER

// These are methods of a DocParser object, defined below.

var makeBlock = function(tag, start_line, start_column) {
    return { t: tag,
             open: true,
             last_line_blank: false,
             start_line: start_line,
             start_column: start_column,
             end_line: start_line,
             children: [],
             parent: null,
             // string_content is formed by concatenating strings, in finalize:
             string_content: "",
             strings: [],
             inline_content: []
           };
};

// Returns true if parent block can contain child block.
var canContain = function(parent_type, child_type) {
    return ( parent_type == 'Document' ||
             parent_type == 'BlockQuote' ||
             parent_type == 'ListItem' ||
             (parent_type == 'List' && child_type == 'ListItem') );
};

// Returns true if block type can accept lines of text.
var acceptsLines = function(block_type) {
    return ( block_type == 'Paragraph' ||
             block_type == 'IndentedCode' ||
             block_type == 'FencedCode' );
};

// Returns true if block ends with a blank line, descending if needed
// into lists and sublists.
var endsWithBlankLine = function(block) {
    if (block.last_line_blank) {
        return true;
    }
    if ((block.t == 'List' || block.t == 'ListItem') && block.children.length > 0) {
        return endsWithBlankLine(block.children[block.children.length - 1]);
    } else {
        return false;
    }
};

// Break out of all containing lists, resetting the tip of the
// document to the parent of the highest list, and finalizing
// all the lists.  (This is used to implement the "two blank lines
// break of of all lists" feature.)
var breakOutOfLists = function(block, line_number) {
    var b = block;
    var last_list = null;
    do {
        if (b.t === 'List') {
            last_list = b;
        }
        b = b.parent;
    } while (b);

    if (last_list) {
        while (block != last_list) {
            this.finalize(block, line_number);
            block = block.parent;
        }
        this.finalize(last_list, line_number);
        this.tip = last_list.parent;
    }
};

// Add a line to the block at the tip.  We assume the tip
// can accept lines -- that check should be done before calling this.
var addLine = function(ln, offset) {
    var s = ln.slice(offset);
    if (!(this.tip.open)) {
        throw({ msg: "Attempted to add line (" + ln + ") to closed container." });
    }
    this.tip.strings.push(s);
};

// Add block of type tag as a child of the tip.  If the tip can't
// accept children, close and finalize it and try its parent,
// and so on til we find a block that can accept children.
var addChild = function(tag, line_number, offset) {
    while (!canContain(this.tip.t, tag)) {
        this.finalize(this.tip, line_number);
    }

    var column_number = offset + 1; // offset 0 = column 1
    var newBlock = makeBlock(tag, line_number, column_number);
    this.tip.children.push(newBlock);
    newBlock.parent = this.tip;
    this.tip = newBlock;
    return newBlock;
};

// Parse a list marker and return data on the marker (type,
// start, delimiter, bullet character, padding) or null.
var parseListMarker = function(ln, offset) {
    var rest = ln.slice(offset);
    var match;
    var spaces_after_marker;
    var data = {};
    if (rest.match(reHrule)) {
        return null;
    }
    if ((match = rest.match(/^[*+-]( +|$)/))) {
        spaces_after_marker = match[1].length;
        data.type = 'Bullet';
        data.bullet_char = match[0][0];

    } else if ((match = rest.match(/^(\d+)([.)])( +|$)/))) {
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

// Analyze a line of text and update the document appropriately.
// We parse markdown text by calling this on each line of input,
// then finalizing the document.
var incorporateLine = function(ln, line_number) {

    var all_matched = true;
    var last_child;
    var first_nonspace;
    var offset = 0;
    var match;
    var data;
    var blank;
    var indent;
    var last_matched_container;
    var i;
    var CODE_INDENT = 4;

    var container = this.doc;
    var oldtip = this.tip;

    // Convert tabs to spaces:
    ln = detabLine(ln);

    // For each containing block, try to parse the associated line start.
    // Bail out on failure: container will point to the last matching block.
    // Set all_matched to false if not all containers match.
    while (container.children.length > 0) {
        last_child = container.children[container.children.length - 1];
        if (!last_child.open) {
            break;
        }
        container = last_child;

        match = matchAt(/[^ ]/, ln, offset);
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

        case 'ListItem':
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

        case 'ATXHeader':
        case 'SetextHeader':
        case 'HorizontalRule':
            // a header can never container > 1 line, so fail to match:
            all_matched = false;
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

    last_matched_container = container;

    // This function is used to finalize and close any unmatched
    // blocks.  We aren't ready to do this now, because we might
    // have a lazy paragraph continuation, in which case we don't
    // want to close unmatched blocks.  So we store this closure for
    // use later, when we have more information.
    var closeUnmatchedBlocks = function(mythis) {
        // finalize any blocks not matched
        while (!already_done && oldtip != last_matched_container) {
            mythis.finalize(oldtip, line_number);
            oldtip = oldtip.parent;
        }
        var already_done = true;
    };

    // Check to see if we've hit 2nd blank line; if so break out of list:
    if (blank && container.last_line_blank) {
        this.breakOutOfLists(container, line_number);
    }

    // Unless last matched container is a code block, try new container starts,
    // adding children to the last matched container:
    while (container.t != 'FencedCode' &&
           container.t != 'IndentedCode' &&
           container.t != 'HtmlBlock' &&
           // this is a little performance optimization:
           matchAt(/^[ #`~*+_=<>0-9-]/,ln,offset) !== -1) {

        match = matchAt(/[^ ]/, ln, offset);
        if (match === -1) {
            first_nonspace = ln.length;
            blank = true;
        } else {
            first_nonspace = match;
            blank = false;
        }
        indent = first_nonspace - offset;

        if (indent >= CODE_INDENT) {
            // indented code
            if (this.tip.t != 'Paragraph' && !blank) {
                offset += CODE_INDENT;
                closeUnmatchedBlocks(this);
                container = this.addChild('IndentedCode', line_number, offset);
            } else { // indent > 4 in a lazy paragraph continuation
                break;
            }

        } else if (ln.charCodeAt(first_nonspace) === C_GREATERTHAN) {
            // blockquote
            offset = first_nonspace + 1;
            // optional following space
            if (ln.charCodeAt(offset) === C_SPACE) {
                offset++;
            }
            closeUnmatchedBlocks(this);
            container = this.addChild('BlockQuote', line_number, offset);

        } else if ((match = ln.slice(first_nonspace).match(/^#{1,6}(?: +|$)/))) {
            // ATX header
            offset = first_nonspace + match[0].length;
            closeUnmatchedBlocks(this);
            container = this.addChild('ATXHeader', line_number, first_nonspace);
            container.level = match[0].trim().length; // number of #s
            // remove trailing ###s:
            container.strings =
                [ln.slice(offset).replace(/^ *#+ *$/, '').replace(/ +#+ *$/,'')];
            break;

        } else if ((match = ln.slice(first_nonspace).match(/^`{3,}(?!.*`)|^~{3,}(?!.*~)/))) {
            // fenced code block
            var fence_length = match[0].length;
            closeUnmatchedBlocks(this);
            container = this.addChild('FencedCode', line_number, first_nonspace);
            container.fence_length = fence_length;
            container.fence_char = match[0][0];
            container.fence_offset = first_nonspace - offset;
            offset = first_nonspace + fence_length;
            break;

        } else if (matchAt(reHtmlBlockOpen, ln, first_nonspace) !== -1) {
            // html block
            closeUnmatchedBlocks(this);
            container = this.addChild('HtmlBlock', line_number, first_nonspace);
            // note, we don't adjust offset because the tag is part of the text
            break;

        } else if (container.t == 'Paragraph' &&
                   container.strings.length === 1 &&
                   ((match = ln.slice(first_nonspace).match(/^(?:=+|-+) *$/)))) {
            // setext header line
            closeUnmatchedBlocks(this);
            container.t = 'SetextHeader'; // convert Paragraph to SetextHeader
            container.level = match[0][0] === '=' ? 1 : 2;
            offset = ln.length;

        } else if (matchAt(reHrule, ln, first_nonspace) !== -1) {
            // hrule
            closeUnmatchedBlocks(this);
            container = this.addChild('HorizontalRule', line_number, first_nonspace);
            offset = ln.length - 1;
            break;

        } else if ((data = parseListMarker(ln, first_nonspace))) {
            // list item
            closeUnmatchedBlocks(this);
            data.marker_offset = indent;
            offset = first_nonspace + data.padding;

            // add the list if needed
            if (container.t !== 'List' ||
                !(listsMatch(container.list_data, data))) {
                container = this.addChild('List', line_number, first_nonspace);
                container.list_data = data;
            }

            // add the list item
            container = this.addChild('ListItem', line_number, first_nonspace);
            container.list_data = data;

        } else {
            break;

        }

        if (acceptsLines(container.t)) {
            // if it's a line container, it can't contain other containers
            break;
        }
    }

    // What remains at the offset is a text line.  Add the text to the
    // appropriate container.

    match = matchAt(/[^ ]/, ln, offset);
    if (match === -1) {
        first_nonspace = ln.length;
        blank = true;
    } else {
        first_nonspace = match;
        blank = false;
    }
    indent = first_nonspace - offset;

    // First check for a lazy paragraph continuation:
    if (this.tip !== last_matched_container &&
        !blank &&
        this.tip.t == 'Paragraph' &&
        this.tip.strings.length > 0) {
        // lazy paragraph continuation

        this.last_line_blank = false;
        this.addLine(ln, offset);

    } else { // not a lazy continuation

        // finalize any blocks not matched
        closeUnmatchedBlocks(this);

        // Block quote lines are never blank as they start with >
        // and we don't count blanks in fenced code for purposes of tight/loose
        // lists or breaking out of lists.  We also don't set last_line_blank
        // on an empty list item.
        container.last_line_blank = blank &&
            !(container.t == 'BlockQuote' ||
              container.t == 'FencedCode' ||
              (container.t == 'ListItem' &&
               container.children.length === 0 &&
               container.start_line == line_number));

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
                     ln.charAt(first_nonspace) == container.fence_char &&
                     ln.slice(first_nonspace).match(/^(?:`{3,}|~{3,})(?= *$)/));
            if (match && match[0].length >= container.fence_length) {
                // don't add closing fence to container; instead, close it:
                this.finalize(container, line_number);
            } else {
                this.addLine(ln, offset);
            }
            break;

        case 'ATXHeader':
        case 'SetextHeader':
        case 'HorizontalRule':
            // nothing to do; we already added the contents.
            break;

        default:
            if (acceptsLines(container.t)) {
                this.addLine(ln, first_nonspace);
            } else if (blank) {
                // do nothing
            } else if (container.t != 'HorizontalRule' &&
                       container.t != 'SetextHeader') {
                // create paragraph container for line
                container = this.addChild('Paragraph', line_number, first_nonspace);
                this.addLine(ln, first_nonspace);
            } else {
                console.log("Line " + line_number.toString() +
                            " with container type " + container.t +
                            " did not match any condition.");

            }
        }
    }
};

// Finalize a block.  Close it and do any necessary postprocessing,
// e.g. creating string_content from strings, setting the 'tight'
// or 'loose' status of a list, and parsing the beginnings
// of paragraphs for reference definitions.  Reset the tip to the
// parent of the closed block.
var finalize = function(block, line_number) {
    var pos;
    // don't do anything if the block is already closed
    if (!block.open) {
        return 0;
    }
    block.open = false;
    if (line_number > block.start_line) {
        block.end_line = line_number - 1;
    } else {
        block.end_line = line_number;
    }

    switch (block.t) {
    case 'Paragraph':
        block.string_content = block.strings.join('\n').replace(/^  */m,'');
        // delete block.strings;

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

    case 'ATXHeader':
    case 'SetextHeader':
    case 'HtmlBlock':
        block.string_content = block.strings.join('\n');
        break;

    case 'IndentedCode':
        block.string_content = block.strings.join('\n').replace(/(\n *)*$/,'\n');
        break;

    case 'FencedCode':
        // first line becomes info string
        block.info = unescapeString(block.strings[0].trim());
        if (block.strings.length == 1) {
            block.string_content = '';
        } else {
            block.string_content = block.strings.slice(1).join('\n') + '\n';
        }
        break;

    case 'List':
        block.tight = true; // tight by default

        var numitems = block.children.length;
        var i = 0;
        while (i < numitems) {
            var item = block.children[i];
            // check for non-final list item ending with blank line:
            var last_item = i == numitems - 1;
            if (endsWithBlankLine(item) && !last_item) {
                block.tight = false;
                break;
            }
            // recurse into children of list item, to see if there are
            // spaces between any of them:
            var numsubitems = item.children.length;
            var j = 0;
            while (j < numsubitems) {
                var subitem = item.children[j];
                var last_subitem = j == numsubitems - 1;
                if (endsWithBlankLine(subitem) && !(last_item && last_subitem)) {
                    block.tight = false;
                    break;
                }
                j++;
            }
            i++;
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
    var newblock = {};
    newblock.t = block.t;
    newblock.start_line = block.start_line;
    newblock.start_column = block.start_column;
    newblock.end_line = block.end_line;

    switch(block.t) {
    case 'Paragraph':
        newblock.inline_content =
            this.inlineParser.parse(block.string_content.trim(), this.refmap);
        break;
    case 'SetextHeader':
    case 'ATXHeader':
        newblock.inline_content =
            this.inlineParser.parse(block.string_content.trim(), this.refmap);
        newblock.level = block.level;
        break;
    case 'List':
        newblock.list_data = block.list_data;
        newblock.tight = block.tight;
        break;
    case 'FencedCode':
        newblock.string_content = block.string_content;
        newblock.info = block.info;
        break;
    case 'IndentedCode':
    case 'HtmlBlock':
        newblock.string_content = block.string_content;
        break;
    default:
        break;
    }

    if (block.children) {
        var newchildren = [];
        for (var i = 0; i < block.children.length; i++) {
            newchildren.push(this.processInlines(block.children[i]));
        }
        newblock.children = newchildren;
    }
    return newblock;
};

// The main parsing function.  Returns a parsed document AST.
var parse = function(input) {
    this.doc = makeBlock('Document', 1, 1);
    this.tip = this.doc;
    this.refmap = {};
    var lines = input.replace(/\n$/,'').split(/\r\n|\n|\r/);
    var len = lines.length;
    for (var i = 0; i < len; i++) {
        this.incorporateLine(lines[i], i+1);
    }
    while (this.tip) {
        this.finalize(this.tip, len - 1);
    }
    return this.processInlines(this.doc);
};


// The DocParser object.
function DocParser(){
    return {
        doc: makeBlock('Document', 1, 1),
        tip: this.doc,
        refmap: {},
        inlineParser: new InlineParser(),
        breakOutOfLists: breakOutOfLists,
        addLine: addLine,
        addChild: addChild,
        incorporateLine: incorporateLine,
        finalize: finalize,
        processInlines: processInlines,
        parse: parse
    };
}

module.exports = DocParser;

},{"./inlines":6}],2:[function(require,module,exports){
// derived from https://github.com/mathiasbynens/String.fromCodePoint
/*! http://mths.be/fromcodepoint v0.2.1 by @mathias */
if (String.fromCodePoint) {

  module.exports = String.fromCodePoint;

} else {

  var stringFromCharCode = String.fromCharCode;
  var floor = Math.floor;
  var fromCodePoint = function(_) {
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
                  floor(codePoint) != codePoint // not an integer
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
          if (index + 1 == length || codeUnits.length > MAX_SIZE) {
              result += stringFromCharCode.apply(null, codeUnits);
              codeUnits.length = 0;
          }
      }
      return result;
  };
  module.exports = fromCodePoint;
}

},{}],3:[function(require,module,exports){
// Helper function to produce content in a pair of HTML tags.
var inTags = function(tag, attribs, contents, selfclosing) {
    var result = '<' + tag;
    if (attribs) {
        var i = 0;
        var attrib;
        while ((attrib = attribs[i]) !== undefined) {
            result = result.concat(' ', attrib[0], '="', attrib[1], '"');
            i++;
        }
    }
    if (contents) {
        result = result.concat('>', contents, '</', tag, '>');
    } else if (selfclosing) {
        result = result + ' />';
    } else {
        result = result.concat('></', tag, '>');
    }
    return result;
};

// Render an inline element as HTML.
var renderInline = function(inline) {
    var attrs;
    switch (inline.t) {
    case 'Str':
        return this.escape(inline.c);
    case 'Softbreak':
        return this.softbreak;
    case 'Hardbreak':
        return inTags('br',[],"",true) + '\n';
    case 'Emph':
        return inTags('em', [], this.renderInlines(inline.c));
    case 'Strong':
        return inTags('strong', [], this.renderInlines(inline.c));
    case 'Html':
        return inline.c;
    case 'Link':
        attrs = [['href', this.escape(inline.destination, true)]];
        if (inline.title) {
            attrs.push(['title', this.escape(inline.title, true)]);
        }
        return inTags('a', attrs, this.renderInlines(inline.label));
    case 'Image':
        attrs = [['src', this.escape(inline.destination, true)],
                 ['alt', this.renderInlines(inline.label).
                    replace(/\<[^>]*alt="([^"]*)"[^>]*\>/g, '$1').
                    replace(/\<[^>]*\>/g,'')]];
        if (inline.title) {
            attrs.push(['title', this.escape(inline.title, true)]);
        }
        return inTags('img', attrs, "", true);
    case 'Code':
        return inTags('code', [], this.escape(inline.c));
    default:
        console.log("Unknown inline type " + inline.t);
        return "";
    }
};

// Render a list of inlines.
var renderInlines = function(inlines) {
    var result = '';
    for (var i=0; i < inlines.length; i++) {
        result = result + this.renderInline(inlines[i]);
    }
    return result;
};

// Render a single block element.
var renderBlock = function(block, in_tight_list) {
    var tag;
    var attr;
    var info_words;
    switch (block.t) {
    case 'Document':
        var whole_doc = this.renderBlocks(block.children);
        return (whole_doc === '' ? '' : whole_doc + '\n');
    case 'Paragraph':
        if (in_tight_list) {
            return this.renderInlines(block.inline_content);
        } else {
            return inTags('p', [], this.renderInlines(block.inline_content));
        }
        break;
    case 'BlockQuote':
        var filling = this.renderBlocks(block.children);
        return inTags('blockquote', [], filling === '' ? this.innersep :
                      this.innersep + filling + this.innersep);
    case 'ListItem':
        return inTags('li', [], this.renderBlocks(block.children, in_tight_list).trim());
    case 'List':
        tag = block.list_data.type == 'Bullet' ? 'ul' : 'ol';
        attr = (!block.list_data.start || block.list_data.start == 1) ?
            [] : [['start', block.list_data.start.toString()]];
        return inTags(tag, attr, this.innersep +
                      this.renderBlocks(block.children, block.tight) +
                      this.innersep);
    case 'ATXHeader':
    case 'SetextHeader':
        tag = 'h' + block.level;
        return inTags(tag, [], this.renderInlines(block.inline_content));
    case 'IndentedCode':
        return inTags('pre', [],
                      inTags('code', [], this.escape(block.string_content)));
    case 'FencedCode':
        info_words = block.info.split(/ +/);
        attr = info_words.length === 0 || info_words[0].length === 0 ?
            [] : [['class','language-' +
                   this.escape(info_words[0],true)]];
        return inTags('pre', [],
                      inTags('code', attr, this.escape(block.string_content)));
    case 'HtmlBlock':
        return block.string_content;
    case 'ReferenceDef':
        return "";
    case 'HorizontalRule':
        return inTags('hr',[],"",true);
    default:
        console.log("Unknown block type " + block.t);
        return "";
    }
};

// Render a list of block elements, separated by this.blocksep.
var renderBlocks = function(blocks, in_tight_list) {
    var result = [];
    for (var i=0; i < blocks.length; i++) {
        if (blocks[i].t !== 'ReferenceDef') {
            result.push(this.renderBlock(blocks[i], in_tight_list));
        }
    }
    return result.join(this.blocksep);
};

// The HtmlRenderer object.
function HtmlRenderer(){
    return {
        // default options:
        blocksep: '\n',  // space between blocks
        innersep: '\n',  // space between block container tag and contents
        softbreak: '\n', // by default, soft breaks are rendered as newlines in HTML
        // set to "<br />" to make them hard breaks
        // set to " " if you want to ignore line wrapping in source
        escape: function(s, preserve_entities) {
            if (preserve_entities) {
                return s.replace(/[&](?![#](x[a-f0-9]{1,8}|[0-9]{1,8});|[a-z][a-z0-9]{1,31};)/gi,'&amp;')
                    .replace(/[<]/g,'&lt;')
                    .replace(/[>]/g,'&gt;')
                    .replace(/["]/g,'&quot;');
            } else {
                return s.replace(/[&]/g,'&amp;')
                    .replace(/[<]/g,'&lt;')
                    .replace(/[>]/g,'&gt;')
                    .replace(/["]/g,'&quot;');
            }
        },
        renderInline: renderInline,
        renderInlines: renderInlines,
        renderBlock: renderBlock,
        renderBlocks: renderBlocks,
        render: renderBlock
    };
}

module.exports = HtmlRenderer;

},{}],4:[function(require,module,exports){
var fromCodePoint = require('./from-code-point');

var entities = { AAacute: 'Á',
                 aacute: 'á',
                 Abreve: 'Ă',
                 abreve: 'ă',
                 ac: '∾',
                 acd: '∿',
                 acE: '∾',
                 Acirc: 'Â',
                 acirc: 'â',
                 acute: '´',
                 Acy: 'А',
                 acy: 'а',
                 AElig: 'Æ',
                 aelig: 'æ',
                 af: '⁡',
                 Afr: '𝔄',
                 afr: '𝔞',
                 Agrave: 'À',
                 agrave: 'à',
                 alefsym: 'ℵ',
                 aleph: 'ℵ',
                 Alpha: 'Α',
                 alpha: 'α',
                 Amacr: 'Ā',
                 amacr: 'ā',
                 amalg: '⨿',
                 amp: '&',
                 AMP: '&',
                 andand: '⩕',
                 And: '⩓',
                 and: '∧',
                 andd: '⩜',
                 andslope: '⩘',
                 andv: '⩚',
                 ang: '∠',
                 ange: '⦤',
                 angle: '∠',
                 angmsdaa: '⦨',
                 angmsdab: '⦩',
                 angmsdac: '⦪',
                 angmsdad: '⦫',
                 angmsdae: '⦬',
                 angmsdaf: '⦭',
                 angmsdag: '⦮',
                 angmsdah: '⦯',
                 angmsd: '∡',
                 angrt: '∟',
                 angrtvb: '⊾',
                 angrtvbd: '⦝',
                 angsph: '∢',
                 angst: 'Å',
                 angzarr: '⍼',
                 Aogon: 'Ą',
                 aogon: 'ą',
                 Aopf: '𝔸',
                 aopf: '𝕒',
                 apacir: '⩯',
                 ap: '≈',
                 apE: '⩰',
                 ape: '≊',
                 apid: '≋',
                 apos: '\'',
                 ApplyFunction: '⁡',
                 approx: '≈',
                 approxeq: '≊',
                 Aring: 'Å',
                 aring: 'å',
                 Ascr: '𝒜',
                 ascr: '𝒶',
                 Assign: '≔',
                 ast: '*',
                 asymp: '≈',
                 asympeq: '≍',
                 Atilde: 'Ã',
                 atilde: 'ã',
                 Auml: 'Ä',
                 auml: 'ä',
                 awconint: '∳',
                 awint: '⨑',
                 backcong: '≌',
                 backepsilon: '϶',
                 backprime: '‵',
                 backsim: '∽',
                 backsimeq: '⋍',
                 Backslash: '∖',
                 Barv: '⫧',
                 barvee: '⊽',
                 barwed: '⌅',
                 Barwed: '⌆',
                 barwedge: '⌅',
                 bbrk: '⎵',
                 bbrktbrk: '⎶',
                 bcong: '≌',
                 Bcy: 'Б',
                 bcy: 'б',
                 bdquo: '„',
                 becaus: '∵',
                 because: '∵',
                 Because: '∵',
                 bemptyv: '⦰',
                 bepsi: '϶',
                 bernou: 'ℬ',
                 Bernoullis: 'ℬ',
                 Beta: 'Β',
                 beta: 'β',
                 beth: 'ℶ',
                 between: '≬',
                 Bfr: '𝔅',
                 bfr: '𝔟',
                 bigcap: '⋂',
                 bigcirc: '◯',
                 bigcup: '⋃',
                 bigodot: '⨀',
                 bigoplus: '⨁',
                 bigotimes: '⨂',
                 bigsqcup: '⨆',
                 bigstar: '★',
                 bigtriangledown: '▽',
                 bigtriangleup: '△',
                 biguplus: '⨄',
                 bigvee: '⋁',
                 bigwedge: '⋀',
                 bkarow: '⤍',
                 blacklozenge: '⧫',
                 blacksquare: '▪',
                 blacktriangle: '▴',
                 blacktriangledown: '▾',
                 blacktriangleleft: '◂',
                 blacktriangleright: '▸',
                 blank: '␣',
                 blk12: '▒',
                 blk14: '░',
                 blk34: '▓',
                 block: '█',
                 bne: '=',
                 bnequiv: '≡',
                 bNot: '⫭',
                 bnot: '⌐',
                 Bopf: '𝔹',
                 bopf: '𝕓',
                 bot: '⊥',
                 bottom: '⊥',
                 bowtie: '⋈',
                 boxbox: '⧉',
                 boxdl: '┐',
                 boxdL: '╕',
                 boxDl: '╖',
                 boxDL: '╗',
                 boxdr: '┌',
                 boxdR: '╒',
                 boxDr: '╓',
                 boxDR: '╔',
                 boxh: '─',
                 boxH: '═',
                 boxhd: '┬',
                 boxHd: '╤',
                 boxhD: '╥',
                 boxHD: '╦',
                 boxhu: '┴',
                 boxHu: '╧',
                 boxhU: '╨',
                 boxHU: '╩',
                 boxminus: '⊟',
                 boxplus: '⊞',
                 boxtimes: '⊠',
                 boxul: '┘',
                 boxuL: '╛',
                 boxUl: '╜',
                 boxUL: '╝',
                 boxur: '└',
                 boxuR: '╘',
                 boxUr: '╙',
                 boxUR: '╚',
                 boxv: '│',
                 boxV: '║',
                 boxvh: '┼',
                 boxvH: '╪',
                 boxVh: '╫',
                 boxVH: '╬',
                 boxvl: '┤',
                 boxvL: '╡',
                 boxVl: '╢',
                 boxVL: '╣',
                 boxvr: '├',
                 boxvR: '╞',
                 boxVr: '╟',
                 boxVR: '╠',
                 bprime: '‵',
                 breve: '˘',
                 Breve: '˘',
                 brvbar: '¦',
                 bscr: '𝒷',
                 Bscr: 'ℬ',
                 bsemi: '⁏',
                 bsim: '∽',
                 bsime: '⋍',
                 bsolb: '⧅',
                 bsol: '\\',
                 bsolhsub: '⟈',
                 bull: '•',
                 bullet: '•',
                 bump: '≎',
                 bumpE: '⪮',
                 bumpe: '≏',
                 Bumpeq: '≎',
                 bumpeq: '≏',
                 Cacute: 'Ć',
                 cacute: 'ć',
                 capand: '⩄',
                 capbrcup: '⩉',
                 capcap: '⩋',
                 cap: '∩',
                 Cap: '⋒',
                 capcup: '⩇',
                 capdot: '⩀',
                 CapitalDifferentialD: 'ⅅ',
                 caps: '∩',
                 caret: '⁁',
                 caron: 'ˇ',
                 Cayleys: 'ℭ',
                 ccaps: '⩍',
                 Ccaron: 'Č',
                 ccaron: 'č',
                 Ccedil: 'Ç',
                 ccedil: 'ç',
                 Ccirc: 'Ĉ',
                 ccirc: 'ĉ',
                 Cconint: '∰',
                 ccups: '⩌',
                 ccupssm: '⩐',
                 Cdot: 'Ċ',
                 cdot: 'ċ',
                 cedil: '¸',
                 Cedilla: '¸',
                 cemptyv: '⦲',
                 cent: '¢',
                 centerdot: '·',
                 CenterDot: '·',
                 cfr: '𝔠',
                 Cfr: 'ℭ',
                 CHcy: 'Ч',
                 chcy: 'ч',
                 check: '✓',
                 checkmark: '✓',
                 Chi: 'Χ',
                 chi: 'χ',
                 circ: 'ˆ',
                 circeq: '≗',
                 circlearrowleft: '↺',
                 circlearrowright: '↻',
                 circledast: '⊛',
                 circledcirc: '⊚',
                 circleddash: '⊝',
                 CircleDot: '⊙',
                 circledR: '®',
                 circledS: 'Ⓢ',
                 CircleMinus: '⊖',
                 CirclePlus: '⊕',
                 CircleTimes: '⊗',
                 cir: '○',
                 cirE: '⧃',
                 cire: '≗',
                 cirfnint: '⨐',
                 cirmid: '⫯',
                 cirscir: '⧂',
                 ClockwiseContourIntegral: '∲',
                 CloseCurlyDoubleQuote: '”',
                 CloseCurlyQuote: '’',
                 clubs: '♣',
                 clubsuit: '♣',
                 colon: ':',
                 Colon: '∷',
                 Colone: '⩴',
                 colone: '≔',
                 coloneq: '≔',
                 comma: ',',
                 commat: '@',
                 comp: '∁',
                 compfn: '∘',
                 complement: '∁',
                 complexes: 'ℂ',
                 cong: '≅',
                 congdot: '⩭',
                 Congruent: '≡',
                 conint: '∮',
                 Conint: '∯',
                 ContourIntegral: '∮',
                 copf: '𝕔',
                 Copf: 'ℂ',
                 coprod: '∐',
                 Coproduct: '∐',
                 copy: '©',
                 COPY: '©',
                 copysr: '℗',
                 CounterClockwiseContourIntegral: '∳',
                 crarr: '↵',
                 cross: '✗',
                 Cross: '⨯',
                 Cscr: '𝒞',
                 cscr: '𝒸',
                 csub: '⫏',
                 csube: '⫑',
                 csup: '⫐',
                 csupe: '⫒',
                 ctdot: '⋯',
                 cudarrl: '⤸',
                 cudarrr: '⤵',
                 cuepr: '⋞',
                 cuesc: '⋟',
                 cularr: '↶',
                 cularrp: '⤽',
                 cupbrcap: '⩈',
                 cupcap: '⩆',
                 CupCap: '≍',
                 cup: '∪',
                 Cup: '⋓',
                 cupcup: '⩊',
                 cupdot: '⊍',
                 cupor: '⩅',
                 cups: '∪',
                 curarr: '↷',
                 curarrm: '⤼',
                 curlyeqprec: '⋞',
                 curlyeqsucc: '⋟',
                 curlyvee: '⋎',
                 curlywedge: '⋏',
                 curren: '¤',
                 curvearrowleft: '↶',
                 curvearrowright: '↷',
                 cuvee: '⋎',
                 cuwed: '⋏',
                 cwconint: '∲',
                 cwint: '∱',
                 cylcty: '⌭',
                 dagger: '†',
                 Dagger: '‡',
                 daleth: 'ℸ',
                 darr: '↓',
                 Darr: '↡',
                 dArr: '⇓',
                 dash: '‐',
                 Dashv: '⫤',
                 dashv: '⊣',
                 dbkarow: '⤏',
                 dblac: '˝',
                 Dcaron: 'Ď',
                 dcaron: 'ď',
                 Dcy: 'Д',
                 dcy: 'д',
                 ddagger: '‡',
                 ddarr: '⇊',
                 DD: 'ⅅ',
                 dd: 'ⅆ',
                 DDotrahd: '⤑',
                 ddotseq: '⩷',
                 deg: '°',
                 Del: '∇',
                 Delta: 'Δ',
                 delta: 'δ',
                 demptyv: '⦱',
                 dfisht: '⥿',
                 Dfr: '𝔇',
                 dfr: '𝔡',
                 dHar: '⥥',
                 dharl: '⇃',
                 dharr: '⇂',
                 DiacriticalAcute: '´',
                 DiacriticalDot: '˙',
                 DiacriticalDoubleAcute: '˝',
                 DiacriticalGrave: '`',
                 DiacriticalTilde: '˜',
                 diam: '⋄',
                 diamond: '⋄',
                 Diamond: '⋄',
                 diamondsuit: '♦',
                 diams: '♦',
                 die: '¨',
                 DifferentialD: 'ⅆ',
                 digamma: 'ϝ',
                 disin: '⋲',
                 div: '÷',
                 divide: '÷',
                 divideontimes: '⋇',
                 divonx: '⋇',
                 DJcy: 'Ђ',
                 djcy: 'ђ',
                 dlcorn: '⌞',
                 dlcrop: '⌍',
                 dollar: '$',
                 Dopf: '𝔻',
                 dopf: '𝕕',
                 Dot: '¨',
                 dot: '˙',
                 DotDot: '⃜',
                 doteq: '≐',
                 doteqdot: '≑',
                 DotEqual: '≐',
                 dotminus: '∸',
                 dotplus: '∔',
                 dotsquare: '⊡',
                 doublebarwedge: '⌆',
                 DoubleContourIntegral: '∯',
                 DoubleDot: '¨',
                 DoubleDownArrow: '⇓',
                 DoubleLeftArrow: '⇐',
                 DoubleLeftRightArrow: '⇔',
                 DoubleLeftTee: '⫤',
                 DoubleLongLeftArrow: '⟸',
                 DoubleLongLeftRightArrow: '⟺',
                 DoubleLongRightArrow: '⟹',
                 DoubleRightArrow: '⇒',
                 DoubleRightTee: '⊨',
                 DoubleUpArrow: '⇑',
                 DoubleUpDownArrow: '⇕',
                 DoubleVerticalBar: '∥',
                 DownArrowBar: '⤓',
                 downarrow: '↓',
                 DownArrow: '↓',
                 Downarrow: '⇓',
                 DownArrowUpArrow: '⇵',
                 DownBreve: '̑',
                 downdownarrows: '⇊',
                 downharpoonleft: '⇃',
                 downharpoonright: '⇂',
                 DownLeftRightVector: '⥐',
                 DownLeftTeeVector: '⥞',
                 DownLeftVectorBar: '⥖',
                 DownLeftVector: '↽',
                 DownRightTeeVector: '⥟',
                 DownRightVectorBar: '⥗',
                 DownRightVector: '⇁',
                 DownTeeArrow: '↧',
                 DownTee: '⊤',
                 drbkarow: '⤐',
                 drcorn: '⌟',
                 drcrop: '⌌',
                 Dscr: '𝒟',
                 dscr: '𝒹',
                 DScy: 'Ѕ',
                 dscy: 'ѕ',
                 dsol: '⧶',
                 Dstrok: 'Đ',
                 dstrok: 'đ',
                 dtdot: '⋱',
                 dtri: '▿',
                 dtrif: '▾',
                 duarr: '⇵',
                 duhar: '⥯',
                 dwangle: '⦦',
                 DZcy: 'Џ',
                 dzcy: 'џ',
                 dzigrarr: '⟿',
                 Eacute: 'É',
                 eacute: 'é',
                 easter: '⩮',
                 Ecaron: 'Ě',
                 ecaron: 'ě',
                 Ecirc: 'Ê',
                 ecirc: 'ê',
                 ecir: '≖',
                 ecolon: '≕',
                 Ecy: 'Э',
                 ecy: 'э',
                 eDDot: '⩷',
                 Edot: 'Ė',
                 edot: 'ė',
                 eDot: '≑',
                 ee: 'ⅇ',
                 efDot: '≒',
                 Efr: '𝔈',
                 efr: '𝔢',
                 eg: '⪚',
                 Egrave: 'È',
                 egrave: 'è',
                 egs: '⪖',
                 egsdot: '⪘',
                 el: '⪙',
                 Element: '∈',
                 elinters: '⏧',
                 ell: 'ℓ',
                 els: '⪕',
                 elsdot: '⪗',
                 Emacr: 'Ē',
                 emacr: 'ē',
                 empty: '∅',
                 emptyset: '∅',
                 EmptySmallSquare: '◻',
                 emptyv: '∅',
                 EmptyVerySmallSquare: '▫',
                 emsp13: ' ',
                 emsp14: ' ',
                 emsp: ' ',
                 ENG: 'Ŋ',
                 eng: 'ŋ',
                 ensp: ' ',
                 Eogon: 'Ę',
                 eogon: 'ę',
                 Eopf: '𝔼',
                 eopf: '𝕖',
                 epar: '⋕',
                 eparsl: '⧣',
                 eplus: '⩱',
                 epsi: 'ε',
                 Epsilon: 'Ε',
                 epsilon: 'ε',
                 epsiv: 'ϵ',
                 eqcirc: '≖',
                 eqcolon: '≕',
                 eqsim: '≂',
                 eqslantgtr: '⪖',
                 eqslantless: '⪕',
                 Equal: '⩵',
                 equals: '=',
                 EqualTilde: '≂',
                 equest: '≟',
                 Equilibrium: '⇌',
                 equiv: '≡',
                 equivDD: '⩸',
                 eqvparsl: '⧥',
                 erarr: '⥱',
                 erDot: '≓',
                 escr: 'ℯ',
                 Escr: 'ℰ',
                 esdot: '≐',
                 Esim: '⩳',
                 esim: '≂',
                 Eta: 'Η',
                 eta: 'η',
                 ETH: 'Ð',
                 eth: 'ð',
                 Euml: 'Ë',
                 euml: 'ë',
                 euro: '€',
                 excl: '!',
                 exist: '∃',
                 Exists: '∃',
                 expectation: 'ℰ',
                 exponentiale: 'ⅇ',
                 ExponentialE: 'ⅇ',
                 fallingdotseq: '≒',
                 Fcy: 'Ф',
                 fcy: 'ф',
                 female: '♀',
                 ffilig: 'ﬃ',
                 fflig: 'ﬀ',
                 ffllig: 'ﬄ',
                 Ffr: '𝔉',
                 ffr: '𝔣',
                 filig: 'ﬁ',
                 FilledSmallSquare: '◼',
                 FilledVerySmallSquare: '▪',
                 fjlig: 'f',
                 flat: '♭',
                 fllig: 'ﬂ',
                 fltns: '▱',
                 fnof: 'ƒ',
                 Fopf: '𝔽',
                 fopf: '𝕗',
                 forall: '∀',
                 ForAll: '∀',
                 fork: '⋔',
                 forkv: '⫙',
                 Fouriertrf: 'ℱ',
                 fpartint: '⨍',
                 frac12: '½',
                 frac13: '⅓',
                 frac14: '¼',
                 frac15: '⅕',
                 frac16: '⅙',
                 frac18: '⅛',
                 frac23: '⅔',
                 frac25: '⅖',
                 frac34: '¾',
                 frac35: '⅗',
                 frac38: '⅜',
                 frac45: '⅘',
                 frac56: '⅚',
                 frac58: '⅝',
                 frac78: '⅞',
                 frasl: '⁄',
                 frown: '⌢',
                 fscr: '𝒻',
                 Fscr: 'ℱ',
                 gacute: 'ǵ',
                 Gamma: 'Γ',
                 gamma: 'γ',
                 Gammad: 'Ϝ',
                 gammad: 'ϝ',
                 gap: '⪆',
                 Gbreve: 'Ğ',
                 gbreve: 'ğ',
                 Gcedil: 'Ģ',
                 Gcirc: 'Ĝ',
                 gcirc: 'ĝ',
                 Gcy: 'Г',
                 gcy: 'г',
                 Gdot: 'Ġ',
                 gdot: 'ġ',
                 ge: '≥',
                 gE: '≧',
                 gEl: '⪌',
                 gel: '⋛',
                 geq: '≥',
                 geqq: '≧',
                 geqslant: '⩾',
                 gescc: '⪩',
                 ges: '⩾',
                 gesdot: '⪀',
                 gesdoto: '⪂',
                 gesdotol: '⪄',
                 gesl: '⋛',
                 gesles: '⪔',
                 Gfr: '𝔊',
                 gfr: '𝔤',
                 gg: '≫',
                 Gg: '⋙',
                 ggg: '⋙',
                 gimel: 'ℷ',
                 GJcy: 'Ѓ',
                 gjcy: 'ѓ',
                 gla: '⪥',
                 gl: '≷',
                 glE: '⪒',
                 glj: '⪤',
                 gnap: '⪊',
                 gnapprox: '⪊',
                 gne: '⪈',
                 gnE: '≩',
                 gneq: '⪈',
                 gneqq: '≩',
                 gnsim: '⋧',
                 Gopf: '𝔾',
                 gopf: '𝕘',
                 grave: '`',
                 GreaterEqual: '≥',
                 GreaterEqualLess: '⋛',
                 GreaterFullEqual: '≧',
                 GreaterGreater: '⪢',
                 GreaterLess: '≷',
                 GreaterSlantEqual: '⩾',
                 GreaterTilde: '≳',
                 Gscr: '𝒢',
                 gscr: 'ℊ',
                 gsim: '≳',
                 gsime: '⪎',
                 gsiml: '⪐',
                 gtcc: '⪧',
                 gtcir: '⩺',
                 gt: '>',
                 GT: '>',
                 Gt: '≫',
                 gtdot: '⋗',
                 gtlPar: '⦕',
                 gtquest: '⩼',
                 gtrapprox: '⪆',
                 gtrarr: '⥸',
                 gtrdot: '⋗',
                 gtreqless: '⋛',
                 gtreqqless: '⪌',
                 gtrless: '≷',
                 gtrsim: '≳',
                 gvertneqq: '≩',
                 gvnE: '≩',
                 Hacek: 'ˇ',
                 hairsp: ' ',
                 half: '½',
                 hamilt: 'ℋ',
                 HARDcy: 'Ъ',
                 hardcy: 'ъ',
                 harrcir: '⥈',
                 harr: '↔',
                 hArr: '⇔',
                 harrw: '↭',
                 Hat: '^',
                 hbar: 'ℏ',
                 Hcirc: 'Ĥ',
                 hcirc: 'ĥ',
                 hearts: '♥',
                 heartsuit: '♥',
                 hellip: '…',
                 hercon: '⊹',
                 hfr: '𝔥',
                 Hfr: 'ℌ',
                 HilbertSpace: 'ℋ',
                 hksearow: '⤥',
                 hkswarow: '⤦',
                 hoarr: '⇿',
                 homtht: '∻',
                 hookleftarrow: '↩',
                 hookrightarrow: '↪',
                 hopf: '𝕙',
                 Hopf: 'ℍ',
                 horbar: '―',
                 HorizontalLine: '─',
                 hscr: '𝒽',
                 Hscr: 'ℋ',
                 hslash: 'ℏ',
                 Hstrok: 'Ħ',
                 hstrok: 'ħ',
                 HumpDownHump: '≎',
                 HumpEqual: '≏',
                 hybull: '⁃',
                 hyphen: '‐',
                 Iacute: 'Í',
                 iacute: 'í',
                 ic: '⁣',
                 Icirc: 'Î',
                 icirc: 'î',
                 Icy: 'И',
                 icy: 'и',
                 Idot: 'İ',
                 IEcy: 'Е',
                 iecy: 'е',
                 iexcl: '¡',
                 iff: '⇔',
                 ifr: '𝔦',
                 Ifr: 'ℑ',
                 Igrave: 'Ì',
                 igrave: 'ì',
                 ii: 'ⅈ',
                 iiiint: '⨌',
                 iiint: '∭',
                 iinfin: '⧜',
                 iiota: '℩',
                 IJlig: 'Ĳ',
                 ijlig: 'ĳ',
                 Imacr: 'Ī',
                 imacr: 'ī',
                 image: 'ℑ',
                 ImaginaryI: 'ⅈ',
                 imagline: 'ℐ',
                 imagpart: 'ℑ',
                 imath: 'ı',
                 Im: 'ℑ',
                 imof: '⊷',
                 imped: 'Ƶ',
                 Implies: '⇒',
                 incare: '℅',
                 in: '∈',
                 infin: '∞',
                 infintie: '⧝',
                 inodot: 'ı',
                 intcal: '⊺',
                 int: '∫',
                 Int: '∬',
                 integers: 'ℤ',
                 Integral: '∫',
                 intercal: '⊺',
                 Intersection: '⋂',
                 intlarhk: '⨗',
                 intprod: '⨼',
                 InvisibleComma: '⁣',
                 InvisibleTimes: '⁢',
                 IOcy: 'Ё',
                 iocy: 'ё',
                 Iogon: 'Į',
                 iogon: 'į',
                 Iopf: '𝕀',
                 iopf: '𝕚',
                 Iota: 'Ι',
                 iota: 'ι',
                 iprod: '⨼',
                 iquest: '¿',
                 iscr: '𝒾',
                 Iscr: 'ℐ',
                 isin: '∈',
                 isindot: '⋵',
                 isinE: '⋹',
                 isins: '⋴',
                 isinsv: '⋳',
                 isinv: '∈',
                 it: '⁢',
                 Itilde: 'Ĩ',
                 itilde: 'ĩ',
                 Iukcy: 'І',
                 iukcy: 'і',
                 Iuml: 'Ï',
                 iuml: 'ï',
                 Jcirc: 'Ĵ',
                 jcirc: 'ĵ',
                 Jcy: 'Й',
                 jcy: 'й',
                 Jfr: '𝔍',
                 jfr: '𝔧',
                 jmath: 'ȷ',
                 Jopf: '𝕁',
                 jopf: '𝕛',
                 Jscr: '𝒥',
                 jscr: '𝒿',
                 Jsercy: 'Ј',
                 jsercy: 'ј',
                 Jukcy: 'Є',
                 jukcy: 'є',
                 Kappa: 'Κ',
                 kappa: 'κ',
                 kappav: 'ϰ',
                 Kcedil: 'Ķ',
                 kcedil: 'ķ',
                 Kcy: 'К',
                 kcy: 'к',
                 Kfr: '𝔎',
                 kfr: '𝔨',
                 kgreen: 'ĸ',
                 KHcy: 'Х',
                 khcy: 'х',
                 KJcy: 'Ќ',
                 kjcy: 'ќ',
                 Kopf: '𝕂',
                 kopf: '𝕜',
                 Kscr: '𝒦',
                 kscr: '𝓀',
                 lAarr: '⇚',
                 Lacute: 'Ĺ',
                 lacute: 'ĺ',
                 laemptyv: '⦴',
                 lagran: 'ℒ',
                 Lambda: 'Λ',
                 lambda: 'λ',
                 lang: '⟨',
                 Lang: '⟪',
                 langd: '⦑',
                 langle: '⟨',
                 lap: '⪅',
                 Laplacetrf: 'ℒ',
                 laquo: '«',
                 larrb: '⇤',
                 larrbfs: '⤟',
                 larr: '←',
                 Larr: '↞',
                 lArr: '⇐',
                 larrfs: '⤝',
                 larrhk: '↩',
                 larrlp: '↫',
                 larrpl: '⤹',
                 larrsim: '⥳',
                 larrtl: '↢',
                 latail: '⤙',
                 lAtail: '⤛',
                 lat: '⪫',
                 late: '⪭',
                 lates: '⪭',
                 lbarr: '⤌',
                 lBarr: '⤎',
                 lbbrk: '❲',
                 lbrace: '{',
                 lbrack: '[',
                 lbrke: '⦋',
                 lbrksld: '⦏',
                 lbrkslu: '⦍',
                 Lcaron: 'Ľ',
                 lcaron: 'ľ',
                 Lcedil: 'Ļ',
                 lcedil: 'ļ',
                 lceil: '⌈',
                 lcub: '{',
                 Lcy: 'Л',
                 lcy: 'л',
                 ldca: '⤶',
                 ldquo: '“',
                 ldquor: '„',
                 ldrdhar: '⥧',
                 ldrushar: '⥋',
                 ldsh: '↲',
                 le: '≤',
                 lE: '≦',
                 LeftAngleBracket: '⟨',
                 LeftArrowBar: '⇤',
                 leftarrow: '←',
                 LeftArrow: '←',
                 Leftarrow: '⇐',
                 LeftArrowRightArrow: '⇆',
                 leftarrowtail: '↢',
                 LeftCeiling: '⌈',
                 LeftDoubleBracket: '⟦',
                 LeftDownTeeVector: '⥡',
                 LeftDownVectorBar: '⥙',
                 LeftDownVector: '⇃',
                 LeftFloor: '⌊',
                 leftharpoondown: '↽',
                 leftharpoonup: '↼',
                 leftleftarrows: '⇇',
                 leftrightarrow: '↔',
                 LeftRightArrow: '↔',
                 Leftrightarrow: '⇔',
                 leftrightarrows: '⇆',
                 leftrightharpoons: '⇋',
                 leftrightsquigarrow: '↭',
                 LeftRightVector: '⥎',
                 LeftTeeArrow: '↤',
                 LeftTee: '⊣',
                 LeftTeeVector: '⥚',
                 leftthreetimes: '⋋',
                 LeftTriangleBar: '⧏',
                 LeftTriangle: '⊲',
                 LeftTriangleEqual: '⊴',
                 LeftUpDownVector: '⥑',
                 LeftUpTeeVector: '⥠',
                 LeftUpVectorBar: '⥘',
                 LeftUpVector: '↿',
                 LeftVectorBar: '⥒',
                 LeftVector: '↼',
                 lEg: '⪋',
                 leg: '⋚',
                 leq: '≤',
                 leqq: '≦',
                 leqslant: '⩽',
                 lescc: '⪨',
                 les: '⩽',
                 lesdot: '⩿',
                 lesdoto: '⪁',
                 lesdotor: '⪃',
                 lesg: '⋚',
                 lesges: '⪓',
                 lessapprox: '⪅',
                 lessdot: '⋖',
                 lesseqgtr: '⋚',
                 lesseqqgtr: '⪋',
                 LessEqualGreater: '⋚',
                 LessFullEqual: '≦',
                 LessGreater: '≶',
                 lessgtr: '≶',
                 LessLess: '⪡',
                 lesssim: '≲',
                 LessSlantEqual: '⩽',
                 LessTilde: '≲',
                 lfisht: '⥼',
                 lfloor: '⌊',
                 Lfr: '𝔏',
                 lfr: '𝔩',
                 lg: '≶',
                 lgE: '⪑',
                 lHar: '⥢',
                 lhard: '↽',
                 lharu: '↼',
                 lharul: '⥪',
                 lhblk: '▄',
                 LJcy: 'Љ',
                 ljcy: 'љ',
                 llarr: '⇇',
                 ll: '≪',
                 Ll: '⋘',
                 llcorner: '⌞',
                 Lleftarrow: '⇚',
                 llhard: '⥫',
                 lltri: '◺',
                 Lmidot: 'Ŀ',
                 lmidot: 'ŀ',
                 lmoustache: '⎰',
                 lmoust: '⎰',
                 lnap: '⪉',
                 lnapprox: '⪉',
                 lne: '⪇',
                 lnE: '≨',
                 lneq: '⪇',
                 lneqq: '≨',
                 lnsim: '⋦',
                 loang: '⟬',
                 loarr: '⇽',
                 lobrk: '⟦',
                 longleftarrow: '⟵',
                 LongLeftArrow: '⟵',
                 Longleftarrow: '⟸',
                 longleftrightarrow: '⟷',
                 LongLeftRightArrow: '⟷',
                 Longleftrightarrow: '⟺',
                 longmapsto: '⟼',
                 longrightarrow: '⟶',
                 LongRightArrow: '⟶',
                 Longrightarrow: '⟹',
                 looparrowleft: '↫',
                 looparrowright: '↬',
                 lopar: '⦅',
                 Lopf: '𝕃',
                 lopf: '𝕝',
                 loplus: '⨭',
                 lotimes: '⨴',
                 lowast: '∗',
                 lowbar: '_',
                 LowerLeftArrow: '↙',
                 LowerRightArrow: '↘',
                 loz: '◊',
                 lozenge: '◊',
                 lozf: '⧫',
                 lpar: '(',
                 lparlt: '⦓',
                 lrarr: '⇆',
                 lrcorner: '⌟',
                 lrhar: '⇋',
                 lrhard: '⥭',
                 lrm: '‎',
                 lrtri: '⊿',
                 lsaquo: '‹',
                 lscr: '𝓁',
                 Lscr: 'ℒ',
                 lsh: '↰',
                 Lsh: '↰',
                 lsim: '≲',
                 lsime: '⪍',
                 lsimg: '⪏',
                 lsqb: '[',
                 lsquo: '‘',
                 lsquor: '‚',
                 Lstrok: 'Ł',
                 lstrok: 'ł',
                 ltcc: '⪦',
                 ltcir: '⩹',
                 lt: '<',
                 LT: '<',
                 Lt: '≪',
                 ltdot: '⋖',
                 lthree: '⋋',
                 ltimes: '⋉',
                 ltlarr: '⥶',
                 ltquest: '⩻',
                 ltri: '◃',
                 ltrie: '⊴',
                 ltrif: '◂',
                 ltrPar: '⦖',
                 lurdshar: '⥊',
                 luruhar: '⥦',
                 lvertneqq: '≨',
                 lvnE: '≨',
                 macr: '¯',
                 male: '♂',
                 malt: '✠',
                 maltese: '✠',
                 Map: '⤅',
                 map: '↦',
                 mapsto: '↦',
                 mapstodown: '↧',
                 mapstoleft: '↤',
                 mapstoup: '↥',
                 marker: '▮',
                 mcomma: '⨩',
                 Mcy: 'М',
                 mcy: 'м',
                 mdash: '—',
                 mDDot: '∺',
                 measuredangle: '∡',
                 MediumSpace: ' ',
                 Mellintrf: 'ℳ',
                 Mfr: '𝔐',
                 mfr: '𝔪',
                 mho: '℧',
                 micro: 'µ',
                 midast: '*',
                 midcir: '⫰',
                 mid: '∣',
                 middot: '·',
                 minusb: '⊟',
                 minus: '−',
                 minusd: '∸',
                 minusdu: '⨪',
                 MinusPlus: '∓',
                 mlcp: '⫛',
                 mldr: '…',
                 mnplus: '∓',
                 models: '⊧',
                 Mopf: '𝕄',
                 mopf: '𝕞',
                 mp: '∓',
                 mscr: '𝓂',
                 Mscr: 'ℳ',
                 mstpos: '∾',
                 Mu: 'Μ',
                 mu: 'μ',
                 multimap: '⊸',
                 mumap: '⊸',
                 nabla: '∇',
                 Nacute: 'Ń',
                 nacute: 'ń',
                 nang: '∠',
                 nap: '≉',
                 napE: '⩰',
                 napid: '≋',
                 napos: 'ŉ',
                 napprox: '≉',
                 natural: '♮',
                 naturals: 'ℕ',
                 natur: '♮',
                 nbsp: ' ',
                 nbump: '≎',
                 nbumpe: '≏',
                 ncap: '⩃',
                 Ncaron: 'Ň',
                 ncaron: 'ň',
                 Ncedil: 'Ņ',
                 ncedil: 'ņ',
                 ncong: '≇',
                 ncongdot: '⩭',
                 ncup: '⩂',
                 Ncy: 'Н',
                 ncy: 'н',
                 ndash: '–',
                 nearhk: '⤤',
                 nearr: '↗',
                 neArr: '⇗',
                 nearrow: '↗',
                 ne: '≠',
                 nedot: '≐',
                 NegativeMediumSpace: '​',
                 NegativeThickSpace: '​',
                 NegativeThinSpace: '​',
                 NegativeVeryThinSpace: '​',
                 nequiv: '≢',
                 nesear: '⤨',
                 nesim: '≂',
                 NestedGreaterGreater: '≫',
                 NestedLessLess: '≪',
                 NewLine: '\n',
                 nexist: '∄',
                 nexists: '∄',
                 Nfr: '𝔑',
                 nfr: '𝔫',
                 ngE: '≧',
                 nge: '≱',
                 ngeq: '≱',
                 ngeqq: '≧',
                 ngeqslant: '⩾',
                 nges: '⩾',
                 nGg: '⋙',
                 ngsim: '≵',
                 nGt: '≫',
                 ngt: '≯',
                 ngtr: '≯',
                 nGtv: '≫',
                 nharr: '↮',
                 nhArr: '⇎',
                 nhpar: '⫲',
                 ni: '∋',
                 nis: '⋼',
                 nisd: '⋺',
                 niv: '∋',
                 NJcy: 'Њ',
                 njcy: 'њ',
                 nlarr: '↚',
                 nlArr: '⇍',
                 nldr: '‥',
                 nlE: '≦',
                 nle: '≰',
                 nleftarrow: '↚',
                 nLeftarrow: '⇍',
                 nleftrightarrow: '↮',
                 nLeftrightarrow: '⇎',
                 nleq: '≰',
                 nleqq: '≦',
                 nleqslant: '⩽',
                 nles: '⩽',
                 nless: '≮',
                 nLl: '⋘',
                 nlsim: '≴',
                 nLt: '≪',
                 nlt: '≮',
                 nltri: '⋪',
                 nltrie: '⋬',
                 nLtv: '≪',
                 nmid: '∤',
                 NoBreak: '⁠',
                 NonBreakingSpace: ' ',
                 nopf: '𝕟',
                 Nopf: 'ℕ',
                 Not: '⫬',
                 not: '¬',
                 NotCongruent: '≢',
                 NotCupCap: '≭',
                 NotDoubleVerticalBar: '∦',
                 NotElement: '∉',
                 NotEqual: '≠',
                 NotEqualTilde: '≂',
                 NotExists: '∄',
                 NotGreater: '≯',
                 NotGreaterEqual: '≱',
                 NotGreaterFullEqual: '≧',
                 NotGreaterGreater: '≫',
                 NotGreaterLess: '≹',
                 NotGreaterSlantEqual: '⩾',
                 NotGreaterTilde: '≵',
                 NotHumpDownHump: '≎',
                 NotHumpEqual: '≏',
                 notin: '∉',
                 notindot: '⋵',
                 notinE: '⋹',
                 notinva: '∉',
                 notinvb: '⋷',
                 notinvc: '⋶',
                 NotLeftTriangleBar: '⧏',
                 NotLeftTriangle: '⋪',
                 NotLeftTriangleEqual: '⋬',
                 NotLess: '≮',
                 NotLessEqual: '≰',
                 NotLessGreater: '≸',
                 NotLessLess: '≪',
                 NotLessSlantEqual: '⩽',
                 NotLessTilde: '≴',
                 NotNestedGreaterGreater: '⪢',
                 NotNestedLessLess: '⪡',
                 notni: '∌',
                 notniva: '∌',
                 notnivb: '⋾',
                 notnivc: '⋽',
                 NotPrecedes: '⊀',
                 NotPrecedesEqual: '⪯',
                 NotPrecedesSlantEqual: '⋠',
                 NotReverseElement: '∌',
                 NotRightTriangleBar: '⧐',
                 NotRightTriangle: '⋫',
                 NotRightTriangleEqual: '⋭',
                 NotSquareSubset: '⊏',
                 NotSquareSubsetEqual: '⋢',
                 NotSquareSuperset: '⊐',
                 NotSquareSupersetEqual: '⋣',
                 NotSubset: '⊂',
                 NotSubsetEqual: '⊈',
                 NotSucceeds: '⊁',
                 NotSucceedsEqual: '⪰',
                 NotSucceedsSlantEqual: '⋡',
                 NotSucceedsTilde: '≿',
                 NotSuperset: '⊃',
                 NotSupersetEqual: '⊉',
                 NotTilde: '≁',
                 NotTildeEqual: '≄',
                 NotTildeFullEqual: '≇',
                 NotTildeTilde: '≉',
                 NotVerticalBar: '∤',
                 nparallel: '∦',
                 npar: '∦',
                 nparsl: '⫽',
                 npart: '∂',
                 npolint: '⨔',
                 npr: '⊀',
                 nprcue: '⋠',
                 nprec: '⊀',
                 npreceq: '⪯',
                 npre: '⪯',
                 nrarrc: '⤳',
                 nrarr: '↛',
                 nrArr: '⇏',
                 nrarrw: '↝',
                 nrightarrow: '↛',
                 nRightarrow: '⇏',
                 nrtri: '⋫',
                 nrtrie: '⋭',
                 nsc: '⊁',
                 nsccue: '⋡',
                 nsce: '⪰',
                 Nscr: '𝒩',
                 nscr: '𝓃',
                 nshortmid: '∤',
                 nshortparallel: '∦',
                 nsim: '≁',
                 nsime: '≄',
                 nsimeq: '≄',
                 nsmid: '∤',
                 nspar: '∦',
                 nsqsube: '⋢',
                 nsqsupe: '⋣',
                 nsub: '⊄',
                 nsubE: '⫅',
                 nsube: '⊈',
                 nsubset: '⊂',
                 nsubseteq: '⊈',
                 nsubseteqq: '⫅',
                 nsucc: '⊁',
                 nsucceq: '⪰',
                 nsup: '⊅',
                 nsupE: '⫆',
                 nsupe: '⊉',
                 nsupset: '⊃',
                 nsupseteq: '⊉',
                 nsupseteqq: '⫆',
                 ntgl: '≹',
                 Ntilde: 'Ñ',
                 ntilde: 'ñ',
                 ntlg: '≸',
                 ntriangleleft: '⋪',
                 ntrianglelefteq: '⋬',
                 ntriangleright: '⋫',
                 ntrianglerighteq: '⋭',
                 Nu: 'Ν',
                 nu: 'ν',
                 num: '#',
                 numero: '№',
                 numsp: ' ',
                 nvap: '≍',
                 nvdash: '⊬',
                 nvDash: '⊭',
                 nVdash: '⊮',
                 nVDash: '⊯',
                 nvge: '≥',
                 nvgt: '>',
                 nvHarr: '⤄',
                 nvinfin: '⧞',
                 nvlArr: '⤂',
                 nvle: '≤',
                 nvlt: '>',
                 nvltrie: '⊴',
                 nvrArr: '⤃',
                 nvrtrie: '⊵',
                 nvsim: '∼',
                 nwarhk: '⤣',
                 nwarr: '↖',
                 nwArr: '⇖',
                 nwarrow: '↖',
                 nwnear: '⤧',
                 Oacute: 'Ó',
                 oacute: 'ó',
                 oast: '⊛',
                 Ocirc: 'Ô',
                 ocirc: 'ô',
                 ocir: '⊚',
                 Ocy: 'О',
                 ocy: 'о',
                 odash: '⊝',
                 Odblac: 'Ő',
                 odblac: 'ő',
                 odiv: '⨸',
                 odot: '⊙',
                 odsold: '⦼',
                 OElig: 'Œ',
                 oelig: 'œ',
                 ofcir: '⦿',
                 Ofr: '𝔒',
                 ofr: '𝔬',
                 ogon: '˛',
                 Ograve: 'Ò',
                 ograve: 'ò',
                 ogt: '⧁',
                 ohbar: '⦵',
                 ohm: 'Ω',
                 oint: '∮',
                 olarr: '↺',
                 olcir: '⦾',
                 olcross: '⦻',
                 oline: '‾',
                 olt: '⧀',
                 Omacr: 'Ō',
                 omacr: 'ō',
                 Omega: 'Ω',
                 omega: 'ω',
                 Omicron: 'Ο',
                 omicron: 'ο',
                 omid: '⦶',
                 ominus: '⊖',
                 Oopf: '𝕆',
                 oopf: '𝕠',
                 opar: '⦷',
                 OpenCurlyDoubleQuote: '“',
                 OpenCurlyQuote: '‘',
                 operp: '⦹',
                 oplus: '⊕',
                 orarr: '↻',
                 Or: '⩔',
                 or: '∨',
                 ord: '⩝',
                 order: 'ℴ',
                 orderof: 'ℴ',
                 ordf: 'ª',
                 ordm: 'º',
                 origof: '⊶',
                 oror: '⩖',
                 orslope: '⩗',
                 orv: '⩛',
                 oS: 'Ⓢ',
                 Oscr: '𝒪',
                 oscr: 'ℴ',
                 Oslash: 'Ø',
                 oslash: 'ø',
                 osol: '⊘',
                 Otilde: 'Õ',
                 otilde: 'õ',
                 otimesas: '⨶',
                 Otimes: '⨷',
                 otimes: '⊗',
                 Ouml: 'Ö',
                 ouml: 'ö',
                 ovbar: '⌽',
                 OverBar: '‾',
                 OverBrace: '⏞',
                 OverBracket: '⎴',
                 OverParenthesis: '⏜',
                 para: '¶',
                 parallel: '∥',
                 par: '∥',
                 parsim: '⫳',
                 parsl: '⫽',
                 part: '∂',
                 PartialD: '∂',
                 Pcy: 'П',
                 pcy: 'п',
                 percnt: '%',
                 period: '.',
                 permil: '‰',
                 perp: '⊥',
                 pertenk: '‱',
                 Pfr: '𝔓',
                 pfr: '𝔭',
                 Phi: 'Φ',
                 phi: 'φ',
                 phiv: 'ϕ',
                 phmmat: 'ℳ',
                 phone: '☎',
                 Pi: 'Π',
                 pi: 'π',
                 pitchfork: '⋔',
                 piv: 'ϖ',
                 planck: 'ℏ',
                 planckh: 'ℎ',
                 plankv: 'ℏ',
                 plusacir: '⨣',
                 plusb: '⊞',
                 pluscir: '⨢',
                 plus: '+',
                 plusdo: '∔',
                 plusdu: '⨥',
                 pluse: '⩲',
                 PlusMinus: '±',
                 plusmn: '±',
                 plussim: '⨦',
                 plustwo: '⨧',
                 pm: '±',
                 Poincareplane: 'ℌ',
                 pointint: '⨕',
                 popf: '𝕡',
                 Popf: 'ℙ',
                 pound: '£',
                 prap: '⪷',
                 Pr: '⪻',
                 pr: '≺',
                 prcue: '≼',
                 precapprox: '⪷',
                 prec: '≺',
                 preccurlyeq: '≼',
                 Precedes: '≺',
                 PrecedesEqual: '⪯',
                 PrecedesSlantEqual: '≼',
                 PrecedesTilde: '≾',
                 preceq: '⪯',
                 precnapprox: '⪹',
                 precneqq: '⪵',
                 precnsim: '⋨',
                 pre: '⪯',
                 prE: '⪳',
                 precsim: '≾',
                 prime: '′',
                 Prime: '″',
                 primes: 'ℙ',
                 prnap: '⪹',
                 prnE: '⪵',
                 prnsim: '⋨',
                 prod: '∏',
                 Product: '∏',
                 profalar: '⌮',
                 profline: '⌒',
                 profsurf: '⌓',
                 prop: '∝',
                 Proportional: '∝',
                 Proportion: '∷',
                 propto: '∝',
                 prsim: '≾',
                 prurel: '⊰',
                 Pscr: '𝒫',
                 pscr: '𝓅',
                 Psi: 'Ψ',
                 psi: 'ψ',
                 puncsp: ' ',
                 Qfr: '𝔔',
                 qfr: '𝔮',
                 qint: '⨌',
                 qopf: '𝕢',
                 Qopf: 'ℚ',
                 qprime: '⁗',
                 Qscr: '𝒬',
                 qscr: '𝓆',
                 quaternions: 'ℍ',
                 quatint: '⨖',
                 quest: '?',
                 questeq: '≟',
                 quot: '"',
                 QUOT: '"',
                 rAarr: '⇛',
                 race: '∽',
                 Racute: 'Ŕ',
                 racute: 'ŕ',
                 radic: '√',
                 raemptyv: '⦳',
                 rang: '⟩',
                 Rang: '⟫',
                 rangd: '⦒',
                 range: '⦥',
                 rangle: '⟩',
                 raquo: '»',
                 rarrap: '⥵',
                 rarrb: '⇥',
                 rarrbfs: '⤠',
                 rarrc: '⤳',
                 rarr: '→',
                 Rarr: '↠',
                 rArr: '⇒',
                 rarrfs: '⤞',
                 rarrhk: '↪',
                 rarrlp: '↬',
                 rarrpl: '⥅',
                 rarrsim: '⥴',
                 Rarrtl: '⤖',
                 rarrtl: '↣',
                 rarrw: '↝',
                 ratail: '⤚',
                 rAtail: '⤜',
                 ratio: '∶',
                 rationals: 'ℚ',
                 rbarr: '⤍',
                 rBarr: '⤏',
                 RBarr: '⤐',
                 rbbrk: '❳',
                 rbrace: '}',
                 rbrack: ']',
                 rbrke: '⦌',
                 rbrksld: '⦎',
                 rbrkslu: '⦐',
                 Rcaron: 'Ř',
                 rcaron: 'ř',
                 Rcedil: 'Ŗ',
                 rcedil: 'ŗ',
                 rceil: '⌉',
                 rcub: '}',
                 Rcy: 'Р',
                 rcy: 'р',
                 rdca: '⤷',
                 rdldhar: '⥩',
                 rdquo: '”',
                 rdquor: '”',
                 rdsh: '↳',
                 real: 'ℜ',
                 realine: 'ℛ',
                 realpart: 'ℜ',
                 reals: 'ℝ',
                 Re: 'ℜ',
                 rect: '▭',
                 reg: '®',
                 REG: '®',
                 ReverseElement: '∋',
                 ReverseEquilibrium: '⇋',
                 ReverseUpEquilibrium: '⥯',
                 rfisht: '⥽',
                 rfloor: '⌋',
                 rfr: '𝔯',
                 Rfr: 'ℜ',
                 rHar: '⥤',
                 rhard: '⇁',
                 rharu: '⇀',
                 rharul: '⥬',
                 Rho: 'Ρ',
                 rho: 'ρ',
                 rhov: 'ϱ',
                 RightAngleBracket: '⟩',
                 RightArrowBar: '⇥',
                 rightarrow: '→',
                 RightArrow: '→',
                 Rightarrow: '⇒',
                 RightArrowLeftArrow: '⇄',
                 rightarrowtail: '↣',
                 RightCeiling: '⌉',
                 RightDoubleBracket: '⟧',
                 RightDownTeeVector: '⥝',
                 RightDownVectorBar: '⥕',
                 RightDownVector: '⇂',
                 RightFloor: '⌋',
                 rightharpoondown: '⇁',
                 rightharpoonup: '⇀',
                 rightleftarrows: '⇄',
                 rightleftharpoons: '⇌',
                 rightrightarrows: '⇉',
                 rightsquigarrow: '↝',
                 RightTeeArrow: '↦',
                 RightTee: '⊢',
                 RightTeeVector: '⥛',
                 rightthreetimes: '⋌',
                 RightTriangleBar: '⧐',
                 RightTriangle: '⊳',
                 RightTriangleEqual: '⊵',
                 RightUpDownVector: '⥏',
                 RightUpTeeVector: '⥜',
                 RightUpVectorBar: '⥔',
                 RightUpVector: '↾',
                 RightVectorBar: '⥓',
                 RightVector: '⇀',
                 ring: '˚',
                 risingdotseq: '≓',
                 rlarr: '⇄',
                 rlhar: '⇌',
                 rlm: '‏',
                 rmoustache: '⎱',
                 rmoust: '⎱',
                 rnmid: '⫮',
                 roang: '⟭',
                 roarr: '⇾',
                 robrk: '⟧',
                 ropar: '⦆',
                 ropf: '𝕣',
                 Ropf: 'ℝ',
                 roplus: '⨮',
                 rotimes: '⨵',
                 RoundImplies: '⥰',
                 rpar: ')',
                 rpargt: '⦔',
                 rppolint: '⨒',
                 rrarr: '⇉',
                 Rrightarrow: '⇛',
                 rsaquo: '›',
                 rscr: '𝓇',
                 Rscr: 'ℛ',
                 rsh: '↱',
                 Rsh: '↱',
                 rsqb: ']',
                 rsquo: '’',
                 rsquor: '’',
                 rthree: '⋌',
                 rtimes: '⋊',
                 rtri: '▹',
                 rtrie: '⊵',
                 rtrif: '▸',
                 rtriltri: '⧎',
                 RuleDelayed: '⧴',
                 ruluhar: '⥨',
                 rx: '℞',
                 Sacute: 'Ś',
                 sacute: 'ś',
                 sbquo: '‚',
                 scap: '⪸',
                 Scaron: 'Š',
                 scaron: 'š',
                 Sc: '⪼',
                 sc: '≻',
                 sccue: '≽',
                 sce: '⪰',
                 scE: '⪴',
                 Scedil: 'Ş',
                 scedil: 'ş',
                 Scirc: 'Ŝ',
                 scirc: 'ŝ',
                 scnap: '⪺',
                 scnE: '⪶',
                 scnsim: '⋩',
                 scpolint: '⨓',
                 scsim: '≿',
                 Scy: 'С',
                 scy: 'с',
                 sdotb: '⊡',
                 sdot: '⋅',
                 sdote: '⩦',
                 searhk: '⤥',
                 searr: '↘',
                 seArr: '⇘',
                 searrow: '↘',
                 sect: '§',
                 semi: ';',
                 seswar: '⤩',
                 setminus: '∖',
                 setmn: '∖',
                 sext: '✶',
                 Sfr: '𝔖',
                 sfr: '𝔰',
                 sfrown: '⌢',
                 sharp: '♯',
                 SHCHcy: 'Щ',
                 shchcy: 'щ',
                 SHcy: 'Ш',
                 shcy: 'ш',
                 ShortDownArrow: '↓',
                 ShortLeftArrow: '←',
                 shortmid: '∣',
                 shortparallel: '∥',
                 ShortRightArrow: '→',
                 ShortUpArrow: '↑',
                 shy: '­',
                 Sigma: 'Σ',
                 sigma: 'σ',
                 sigmaf: 'ς',
                 sigmav: 'ς',
                 sim: '∼',
                 simdot: '⩪',
                 sime: '≃',
                 simeq: '≃',
                 simg: '⪞',
                 simgE: '⪠',
                 siml: '⪝',
                 simlE: '⪟',
                 simne: '≆',
                 simplus: '⨤',
                 simrarr: '⥲',
                 slarr: '←',
                 SmallCircle: '∘',
                 smallsetminus: '∖',
                 smashp: '⨳',
                 smeparsl: '⧤',
                 smid: '∣',
                 smile: '⌣',
                 smt: '⪪',
                 smte: '⪬',
                 smtes: '⪬',
                 SOFTcy: 'Ь',
                 softcy: 'ь',
                 solbar: '⌿',
                 solb: '⧄',
                 sol: '/',
                 Sopf: '𝕊',
                 sopf: '𝕤',
                 spades: '♠',
                 spadesuit: '♠',
                 spar: '∥',
                 sqcap: '⊓',
                 sqcaps: '⊓',
                 sqcup: '⊔',
                 sqcups: '⊔',
                 Sqrt: '√',
                 sqsub: '⊏',
                 sqsube: '⊑',
                 sqsubset: '⊏',
                 sqsubseteq: '⊑',
                 sqsup: '⊐',
                 sqsupe: '⊒',
                 sqsupset: '⊐',
                 sqsupseteq: '⊒',
                 square: '□',
                 Square: '□',
                 SquareIntersection: '⊓',
                 SquareSubset: '⊏',
                 SquareSubsetEqual: '⊑',
                 SquareSuperset: '⊐',
                 SquareSupersetEqual: '⊒',
                 SquareUnion: '⊔',
                 squarf: '▪',
                 squ: '□',
                 squf: '▪',
                 srarr: '→',
                 Sscr: '𝒮',
                 sscr: '𝓈',
                 ssetmn: '∖',
                 ssmile: '⌣',
                 sstarf: '⋆',
                 Star: '⋆',
                 star: '☆',
                 starf: '★',
                 straightepsilon: 'ϵ',
                 straightphi: 'ϕ',
                 strns: '¯',
                 sub: '⊂',
                 Sub: '⋐',
                 subdot: '⪽',
                 subE: '⫅',
                 sube: '⊆',
                 subedot: '⫃',
                 submult: '⫁',
                 subnE: '⫋',
                 subne: '⊊',
                 subplus: '⪿',
                 subrarr: '⥹',
                 subset: '⊂',
                 Subset: '⋐',
                 subseteq: '⊆',
                 subseteqq: '⫅',
                 SubsetEqual: '⊆',
                 subsetneq: '⊊',
                 subsetneqq: '⫋',
                 subsim: '⫇',
                 subsub: '⫕',
                 subsup: '⫓',
                 succapprox: '⪸',
                 succ: '≻',
                 succcurlyeq: '≽',
                 Succeeds: '≻',
                 SucceedsEqual: '⪰',
                 SucceedsSlantEqual: '≽',
                 SucceedsTilde: '≿',
                 succeq: '⪰',
                 succnapprox: '⪺',
                 succneqq: '⪶',
                 succnsim: '⋩',
                 succsim: '≿',
                 SuchThat: '∋',
                 sum: '∑',
                 Sum: '∑',
                 sung: '♪',
                 sup1: '¹',
                 sup2: '²',
                 sup3: '³',
                 sup: '⊃',
                 Sup: '⋑',
                 supdot: '⪾',
                 supdsub: '⫘',
                 supE: '⫆',
                 supe: '⊇',
                 supedot: '⫄',
                 Superset: '⊃',
                 SupersetEqual: '⊇',
                 suphsol: '⟉',
                 suphsub: '⫗',
                 suplarr: '⥻',
                 supmult: '⫂',
                 supnE: '⫌',
                 supne: '⊋',
                 supplus: '⫀',
                 supset: '⊃',
                 Supset: '⋑',
                 supseteq: '⊇',
                 supseteqq: '⫆',
                 supsetneq: '⊋',
                 supsetneqq: '⫌',
                 supsim: '⫈',
                 supsub: '⫔',
                 supsup: '⫖',
                 swarhk: '⤦',
                 swarr: '↙',
                 swArr: '⇙',
                 swarrow: '↙',
                 swnwar: '⤪',
                 szlig: 'ß',
                 Tab: '	',
                 target: '⌖',
                 Tau: 'Τ',
                 tau: 'τ',
                 tbrk: '⎴',
                 Tcaron: 'Ť',
                 tcaron: 'ť',
                 Tcedil: 'Ţ',
                 tcedil: 'ţ',
                 Tcy: 'Т',
                 tcy: 'т',
                 tdot: '⃛',
                 telrec: '⌕',
                 Tfr: '𝔗',
                 tfr: '𝔱',
                 there4: '∴',
                 therefore: '∴',
                 Therefore: '∴',
                 Theta: 'Θ',
                 theta: 'θ',
                 thetasym: 'ϑ',
                 thetav: 'ϑ',
                 thickapprox: '≈',
                 thicksim: '∼',
                 ThickSpace: ' ',
                 ThinSpace: ' ',
                 thinsp: ' ',
                 thkap: '≈',
                 thksim: '∼',
                 THORN: 'Þ',
                 thorn: 'þ',
                 tilde: '˜',
                 Tilde: '∼',
                 TildeEqual: '≃',
                 TildeFullEqual: '≅',
                 TildeTilde: '≈',
                 timesbar: '⨱',
                 timesb: '⊠',
                 times: '×',
                 timesd: '⨰',
                 tint: '∭',
                 toea: '⤨',
                 topbot: '⌶',
                 topcir: '⫱',
                 top: '⊤',
                 Topf: '𝕋',
                 topf: '𝕥',
                 topfork: '⫚',
                 tosa: '⤩',
                 tprime: '‴',
                 trade: '™',
                 TRADE: '™',
                 triangle: '▵',
                 triangledown: '▿',
                 triangleleft: '◃',
                 trianglelefteq: '⊴',
                 triangleq: '≜',
                 triangleright: '▹',
                 trianglerighteq: '⊵',
                 tridot: '◬',
                 trie: '≜',
                 triminus: '⨺',
                 TripleDot: '⃛',
                 triplus: '⨹',
                 trisb: '⧍',
                 tritime: '⨻',
                 trpezium: '⏢',
                 Tscr: '𝒯',
                 tscr: '𝓉',
                 TScy: 'Ц',
                 tscy: 'ц',
                 TSHcy: 'Ћ',
                 tshcy: 'ћ',
                 Tstrok: 'Ŧ',
                 tstrok: 'ŧ',
                 twixt: '≬',
                 twoheadleftarrow: '↞',
                 twoheadrightarrow: '↠',
                 Uacute: 'Ú',
                 uacute: 'ú',
                 uarr: '↑',
                 Uarr: '↟',
                 uArr: '⇑',
                 Uarrocir: '⥉',
                 Ubrcy: 'Ў',
                 ubrcy: 'ў',
                 Ubreve: 'Ŭ',
                 ubreve: 'ŭ',
                 Ucirc: 'Û',
                 ucirc: 'û',
                 Ucy: 'У',
                 ucy: 'у',
                 udarr: '⇅',
                 Udblac: 'Ű',
                 udblac: 'ű',
                 udhar: '⥮',
                 ufisht: '⥾',
                 Ufr: '𝔘',
                 ufr: '𝔲',
                 Ugrave: 'Ù',
                 ugrave: 'ù',
                 uHar: '⥣',
                 uharl: '↿',
                 uharr: '↾',
                 uhblk: '▀',
                 ulcorn: '⌜',
                 ulcorner: '⌜',
                 ulcrop: '⌏',
                 ultri: '◸',
                 Umacr: 'Ū',
                 umacr: 'ū',
                 uml: '¨',
                 UnderBar: '_',
                 UnderBrace: '⏟',
                 UnderBracket: '⎵',
                 UnderParenthesis: '⏝',
                 Union: '⋃',
                 UnionPlus: '⊎',
                 Uogon: 'Ų',
                 uogon: 'ų',
                 Uopf: '𝕌',
                 uopf: '𝕦',
                 UpArrowBar: '⤒',
                 uparrow: '↑',
                 UpArrow: '↑',
                 Uparrow: '⇑',
                 UpArrowDownArrow: '⇅',
                 updownarrow: '↕',
                 UpDownArrow: '↕',
                 Updownarrow: '⇕',
                 UpEquilibrium: '⥮',
                 upharpoonleft: '↿',
                 upharpoonright: '↾',
                 uplus: '⊎',
                 UpperLeftArrow: '↖',
                 UpperRightArrow: '↗',
                 upsi: 'υ',
                 Upsi: 'ϒ',
                 upsih: 'ϒ',
                 Upsilon: 'Υ',
                 upsilon: 'υ',
                 UpTeeArrow: '↥',
                 UpTee: '⊥',
                 upuparrows: '⇈',
                 urcorn: '⌝',
                 urcorner: '⌝',
                 urcrop: '⌎',
                 Uring: 'Ů',
                 uring: 'ů',
                 urtri: '◹',
                 Uscr: '𝒰',
                 uscr: '𝓊',
                 utdot: '⋰',
                 Utilde: 'Ũ',
                 utilde: 'ũ',
                 utri: '▵',
                 utrif: '▴',
                 uuarr: '⇈',
                 Uuml: 'Ü',
                 uuml: 'ü',
                 uwangle: '⦧',
                 vangrt: '⦜',
                 varepsilon: 'ϵ',
                 varkappa: 'ϰ',
                 varnothing: '∅',
                 varphi: 'ϕ',
                 varpi: 'ϖ',
                 varpropto: '∝',
                 varr: '↕',
                 vArr: '⇕',
                 varrho: 'ϱ',
                 varsigma: 'ς',
                 varsubsetneq: '⊊',
                 varsubsetneqq: '⫋',
                 varsupsetneq: '⊋',
                 varsupsetneqq: '⫌',
                 vartheta: 'ϑ',
                 vartriangleleft: '⊲',
                 vartriangleright: '⊳',
                 vBar: '⫨',
                 Vbar: '⫫',
                 vBarv: '⫩',
                 Vcy: 'В',
                 vcy: 'в',
                 vdash: '⊢',
                 vDash: '⊨',
                 Vdash: '⊩',
                 VDash: '⊫',
                 Vdashl: '⫦',
                 veebar: '⊻',
                 vee: '∨',
                 Vee: '⋁',
                 veeeq: '≚',
                 vellip: '⋮',
                 verbar: '|',
                 Verbar: '‖',
                 vert: '|',
                 Vert: '‖',
                 VerticalBar: '∣',
                 VerticalLine: '|',
                 VerticalSeparator: '❘',
                 VerticalTilde: '≀',
                 VeryThinSpace: ' ',
                 Vfr: '𝔙',
                 vfr: '𝔳',
                 vltri: '⊲',
                 vnsub: '⊂',
                 vnsup: '⊃',
                 Vopf: '𝕍',
                 vopf: '𝕧',
                 vprop: '∝',
                 vrtri: '⊳',
                 Vscr: '𝒱',
                 vscr: '𝓋',
                 vsubnE: '⫋',
                 vsubne: '⊊',
                 vsupnE: '⫌',
                 vsupne: '⊋',
                 Vvdash: '⊪',
                 vzigzag: '⦚',
                 Wcirc: 'Ŵ',
                 wcirc: 'ŵ',
                 wedbar: '⩟',
                 wedge: '∧',
                 Wedge: '⋀',
                 wedgeq: '≙',
                 weierp: '℘',
                 Wfr: '𝔚',
                 wfr: '𝔴',
                 Wopf: '𝕎',
                 wopf: '𝕨',
                 wp: '℘',
                 wr: '≀',
                 wreath: '≀',
                 Wscr: '𝒲',
                 wscr: '𝓌',
                 xcap: '⋂',
                 xcirc: '◯',
                 xcup: '⋃',
                 xdtri: '▽',
                 Xfr: '𝔛',
                 xfr: '𝔵',
                 xharr: '⟷',
                 xhArr: '⟺',
                 Xi: 'Ξ',
                 xi: 'ξ',
                 xlarr: '⟵',
                 xlArr: '⟸',
                 xmap: '⟼',
                 xnis: '⋻',
                 xodot: '⨀',
                 Xopf: '𝕏',
                 xopf: '𝕩',
                 xoplus: '⨁',
                 xotime: '⨂',
                 xrarr: '⟶',
                 xrArr: '⟹',
                 Xscr: '𝒳',
                 xscr: '𝓍',
                 xsqcup: '⨆',
                 xuplus: '⨄',
                 xutri: '△',
                 xvee: '⋁',
                 xwedge: '⋀',
                 Yacute: 'Ý',
                 yacute: 'ý',
                 YAcy: 'Я',
                 yacy: 'я',
                 Ycirc: 'Ŷ',
                 ycirc: 'ŷ',
                 Ycy: 'Ы',
                 ycy: 'ы',
                 yen: '¥',
                 Yfr: '𝔜',
                 yfr: '𝔶',
                 YIcy: 'Ї',
                 yicy: 'ї',
                 Yopf: '𝕐',
                 yopf: '𝕪',
                 Yscr: '𝒴',
                 yscr: '𝓎',
                 YUcy: 'Ю',
                 yucy: 'ю',
                 yuml: 'ÿ',
                 Yuml: 'Ÿ',
                 Zacute: 'Ź',
                 zacute: 'ź',
                 Zcaron: 'Ž',
                 zcaron: 'ž',
                 Zcy: 'З',
                 zcy: 'з',
                 Zdot: 'Ż',
                 zdot: 'ż',
                 zeetrf: 'ℨ',
                 ZeroWidthSpace: '​',
                 Zeta: 'Ζ',
                 zeta: 'ζ',
                 zfr: '𝔷',
                 Zfr: 'ℨ',
                 ZHcy: 'Ж',
                 zhcy: 'ж',
                 zigrarr: '⇝',
                 zopf: '𝕫',
                 Zopf: 'ℤ',
                 Zscr: '𝒵',
                 zscr: '𝓏',
                 zwj: '‍',
                 zwnj: '‌' };

var entityToChar = function(m) {
    var isNumeric = /^&#/.test(m);
    var isHex = /^&#[Xx]/.test(m);
    var uchar;
    if (isNumeric) {
        var num;
        if (isHex) {
            num = parseInt(m.slice(3,-1), 16);
        } else {
            num = parseInt(m.slice(2,-1), 10);
        }
        uchar = fromCodePoint(num);
    } else {
        uchar = entities[m.slice(1,-1)];
    }
    return (uchar || m);
};

module.exports.entityToChar = entityToChar;

},{"./from-code-point":2}],5:[function(require,module,exports){
// commonmark.js - CommomMark in JavaScript
// Copyright (C) 2014 John MacFarlane
// License: BSD3.

// Basic usage:
//
// var commonmark = require('commonmark');
// var parser = new commonmark.DocParser();
// var renderer = new commonmark.HtmlRenderer();
// console.log(renderer.render(parser.parse('Hello *world*')));

var util = require('util');

var renderAST = function(tree) {
    return util.inspect(tree, {depth: null});
};

module.exports.DocParser = require('./blocks');
module.exports.HtmlRenderer = require('./html-renderer');
module.exports.ASTRenderer = renderAST;

},{"./blocks":1,"./html-renderer":3,"util":10}],6:[function(require,module,exports){
var fromCodePoint = require('./from-code-point.js');
var entityToChar = require('./html5-entities.js').entityToChar;

// Constants for character codes:

var C_NEWLINE = 10;
var C_SPACE = 32;
var C_ASTERISK = 42;
var C_UNDERSCORE = 95;
var C_BACKTICK = 96;
var C_OPEN_BRACKET = 91;
var C_CLOSE_BRACKET = 93;
var C_LESSTHAN = 60;
var C_GREATERTHAN = 62;
var C_BANG = 33;
var C_BACKSLASH = 92;
var C_AMPERSAND = 38;
var C_OPEN_PAREN = 40;
var C_COLON = 58;

// Some regexps used in inline parser:

var ESCAPABLE = '[!"#$%&\'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]';
var ESCAPED_CHAR = '\\\\' + ESCAPABLE;
var IN_DOUBLE_QUOTES = '"(' + ESCAPED_CHAR + '|[^"\\x00])*"';
var IN_SINGLE_QUOTES = '\'(' + ESCAPED_CHAR + '|[^\'\\x00])*\'';
var IN_PARENS = '\\((' + ESCAPED_CHAR + '|[^)\\x00])*\\)';
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
var HTMLCOMMENT = "<!--([^-]+|[-][^-]+)*-->";
var PROCESSINGINSTRUCTION = "[<][?].*?[?][>]";
var DECLARATION = "<![A-Z]+" + "\\s+[^>]*>";
var CDATA = "<!\\[CDATA\\[([^\\]]+|\\][^\\]]|\\]\\][^>])*\\]\\]>";
var HTMLTAG = "(?:" + OPENTAG + "|" + CLOSETAG + "|" + HTMLCOMMENT + "|" +
        PROCESSINGINSTRUCTION + "|" + DECLARATION + "|" + CDATA + ")";
var ENTITY = "&(?:#x[a-f0-9]{1,8}|#[0-9]{1,8}|[a-z][a-z0-9]{1,31});";

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

var reAllEscapedChar = new RegExp('\\\\(' + ESCAPABLE + ')', 'g');

var reEscapedChar = new RegExp('^\\\\(' + ESCAPABLE + ')');

var reEntityHere = new RegExp('^' + ENTITY, 'i');

var reEntity = new RegExp(ENTITY, 'gi');

// Matches a character with a special meaning in markdown,
// or a string of non-special characters.  Note:  we match
// clumps of _ or * or `, because they need to be handled in groups.
var reMain = /^(?:[_*`\n]+|[\[\]\\!<&*_]|(?: *[^\n `\[\]\\!<&*_]+)+|[ \n]+)/m;

// Replace entities and backslash escapes with literal characters.
var unescapeString = function(s) {
    return s.replace(reAllEscapedChar, '$1')
            .replace(reEntity, entityToChar);
};

// Normalize reference label: collapse internal whitespace
// to single space, remove leading/trailing whitespace, case fold.
var normalizeReference = function(s) {
    return s.trim()
        .replace(/\s+/,' ')
        .toUpperCase();
};

// INLINE PARSER

// These are methods of an InlineParser object, defined below.
// An InlineParser keeps track of a subject (a string to be
// parsed) and a position in that subject.

// If re matches at current position in the subject, advance
// position in subject and return the match; otherwise return null.
var match = function(re) {
    var match = re.exec(this.subject.slice(this.pos));
    if (match) {
        this.pos += match.index + match[0].length;
        return match[0];
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
    this.match(/^ *(?:\n *)?/);
    return 1;
};

// All of the parsers below try to match something at the current position
// in the subject.  If they succeed in matching anything, they
// return the inline matched, advancing the subject.

// Attempt to parse backticks, returning either a backtick code span or a
// literal sequence of backticks.
var parseBackticks = function(inlines) {
    var startpos = this.pos;
    var ticks = this.match(/^`+/);
    if (!ticks) {
        return 0;
    }
    var afterOpenTicks = this.pos;
    var foundCode = false;
    var match;
    while (!foundCode && (match = this.match(/`+/m))) {
        if (match === ticks) {
            inlines.push({ t: 'Code', c: this.subject.slice(afterOpenTicks,
                                                      this.pos - ticks.length)
                     .replace(/[ \n]+/g,' ')
                      .trim() });
            return true;
        }
    }
    // If we got here, we didn't match a closing backtick sequence.
    this.pos = afterOpenTicks;
    inlines.push({ t: 'Str', c: ticks });
    return true;
};

// Parse a backslash-escaped special character, adding either the escaped
// character, a hard line break (if the backslash is followed by a newline),
// or a literal backslash to the 'inlines' list.
var parseBackslash = function(inlines) {
    var subj = this.subject,
        pos  = this.pos;
    if (subj.charCodeAt(pos) === C_BACKSLASH) {
        if (subj.charAt(pos + 1) === '\n') {
            this.pos = this.pos + 2;
            inlines.push({ t: 'Hardbreak' });
        } else if (reEscapable.test(subj.charAt(pos + 1))) {
            this.pos = this.pos + 2;
            inlines.push({ t: 'Str', c: subj.charAt(pos + 1) });
        } else {
            this.pos++;
            inlines.push({t: 'Str', c: '\\'});
        }
        return true;
    } else {
        return false;
    }
};

// Attempt to parse an autolink (URL or email in pointy brackets).
var parseAutolink = function(inlines) {
    var m;
    var dest;
    if ((m = this.match(/^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/))) {  // email autolink
        dest = m.slice(1,-1);
        inlines.push(
                {t: 'Link',
                 label: [{ t: 'Str', c: dest }],
                 destination: 'mailto:' + encodeURI(unescape(dest)) });
        return true;
    } else if ((m = this.match(/^<(?:coap|doi|javascript|aaa|aaas|about|acap|cap|cid|crid|data|dav|dict|dns|file|ftp|geo|go|gopher|h323|http|https|iax|icap|im|imap|info|ipp|iris|iris.beep|iris.xpc|iris.xpcs|iris.lwz|ldap|mailto|mid|msrp|msrps|mtqp|mupdate|news|nfs|ni|nih|nntp|opaquelocktoken|pop|pres|rtsp|service|session|shttp|sieve|sip|sips|sms|snmp|soap.beep|soap.beeps|tag|tel|telnet|tftp|thismessage|tn3270|tip|tv|urn|vemmi|ws|wss|xcon|xcon-userid|xmlrpc.beep|xmlrpc.beeps|xmpp|z39.50r|z39.50s|adiumxtra|afp|afs|aim|apt|attachment|aw|beshare|bitcoin|bolo|callto|chrome|chrome-extension|com-eventbrite-attendee|content|cvs|dlna-playsingle|dlna-playcontainer|dtn|dvb|ed2k|facetime|feed|finger|fish|gg|git|gizmoproject|gtalk|hcp|icon|ipn|irc|irc6|ircs|itms|jar|jms|keyparc|lastfm|ldaps|magnet|maps|market|message|mms|ms-help|msnim|mumble|mvn|notes|oid|palm|paparazzi|platform|proxy|psyc|query|res|resource|rmi|rsync|rtmp|secondlife|sftp|sgn|skype|smb|soldat|spotify|ssh|steam|svn|teamspeak|things|udp|unreal|ut2004|ventrilo|view-source|webcal|wtai|wyciwyg|xfire|xri|ymsgr):[^<>\x00-\x20]*>/i))) {
        dest = m.slice(1,-1);
        inlines.push({
                  t: 'Link',
                  label: [{ t: 'Str', c: dest }],
                  destination: encodeURI(unescape(dest)) });
        return true;
    } else {
        return false;
    }
};

// Attempt to parse a raw HTML tag.
var parseHtmlTag = function(inlines) {
    var m = this.match(reHtmlTag);
    if (m) {
        inlines.push({ t: 'Html', c: m });
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
    var first_close_delims = 0;
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

    var can_open = numdelims > 0 && !(/\s/.test(char_after));
    var can_close = numdelims > 0 && !(/\s/.test(char_before));
    if (cc === C_UNDERSCORE) {
        can_open = can_open && !((/[a-z0-9]/i).test(char_before));
        can_close = can_close && !((/[a-z0-9]/i).test(char_after));
    }
    this.pos = startpos;
    return { numdelims: numdelims,
             can_open: can_open,
             can_close: can_close };
};

var Emph = function(ils) {
    return {t: 'Emph', c: ils};
};

var Strong = function(ils) {
    return {t: 'Strong', c: ils};
};

var Str = function(s) {
    return {t: 'Str', c: s};
};

// Attempt to parse emphasis or strong emphasis.
var parseEmphasis = function(cc,inlines) {

    var res = this.scanDelims(cc);
    var numdelims = res.numdelims;
    var startpos = this.pos;

    if (numdelims === 0) {
        return false;
    }

    this.pos += numdelims;
    inlines.push(Str(this.subject.slice(startpos, this.pos)));

    // Add entry to stack for this opener
    this.delimiters = { cc: cc,
                        numdelims: numdelims,
                        pos: inlines.length - 1,
                        previous: this.delimiters,
                        next: null,
                        can_open: res.can_open,
                        can_close: res.can_close};
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

var removeGaps = function(inlines) {
    // remove gaps from inlines
    var i, j;
    j = 0;
    for (i = 0 ; i < inlines.length; i++) {
        if (inlines[i] !== null) {
            inlines[j] = inlines[i];
            j++;
        }
    }
    inlines.splice(j);
};

var processEmphasis = function(inlines, stack_bottom) {
    var opener, closer;
    var opener_inl, closer_inl;
    var nextstack, tempstack;
    var use_delims;
    var contents;
    var tmp;
    var emph;
    var i,j;

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

                opener_inl = inlines[opener.pos];
                closer_inl = inlines[closer.pos];

                // remove used delimiters from stack elts and inlines
                opener.numdelims -= use_delims;
                closer.numdelims -= use_delims;
                opener_inl.c = opener_inl.c.slice(0, opener_inl.c.length - use_delims);
                closer_inl.c = closer_inl.c.slice(0, closer_inl.c.length - use_delims);

                // build contents for new emph element
                contents = inlines.slice(opener.pos + 1, closer.pos);
                removeGaps(contents);

                emph = use_delims === 1 ? Emph(contents) : Strong(contents);

                // insert into list of inlines
                inlines[opener.pos + 1] = emph;
                for (i = opener.pos + 2; i < closer.pos; i++) {
                    inlines[i] = null;
                }

                // remove elts btw opener and closer in delimiters stack
                tempstack = closer.previous;
                while (tempstack !== null && tempstack !== opener) {
                    nextstack = tempstack.previous;
                    this.removeDelimiter(tempstack);
                    tempstack = nextstack;
                }

                // if opener has 0 delims, remove it and the inline
                if (opener.numdelims === 0) {
                    inlines[opener.pos] = null;
                    this.removeDelimiter(opener);
                }

                if (closer.numdelims === 0) {
                    inlines[closer.pos] = null;
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

    removeGaps(inlines);

    // remove all delimiters
    while (this.delimiters != stack_bottom) {
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
        return encodeURI(unescape(unescapeString(res.substr(1, res.length - 2))));
    } else {
        res = this.match(reLinkDestination);
        if (res !== null) {
            return encodeURI(unescape(unescapeString(res)));
        } else {
            return null;
        }
    }
};

// Attempt to parse a link label, returning number of characters parsed.
var parseLinkLabel = function() {
    var match = this.match(/^\[(?:[^\\\[\]]|\\[\[\]]){0,1000}\]/);
    return match === null ? 0 : match.length;
};

// Parse raw link label, including surrounding [], and return
// inline contents.  (Note:  this is not a method of InlineParser.)
var parseRawLabel = function(s) {
    // note:  parse without a refmap; we don't want links to resolve
    // in nested brackets!
    return new InlineParser().parse(s.substr(1, s.length - 2), {});
};

// Add open bracket to delimiter stack and add a Str to inlines.
var parseOpenBracket = function(inlines) {

    var startpos = this.pos;
    this.pos += 1;
    inlines.push(Str("["));

    // Add entry to stack for this opener
    this.delimiters = { cc: C_OPEN_BRACKET,
                        numdelims: 1,
                        pos: inlines.length - 1,
                        previous: this.delimiters,
                        next: null,
                        can_open: true,
                        can_close: false,
                        index: startpos };
    if (this.delimiters.previous !== null) {
        this.delimiters.previous.next = this.delimiters;
    }
    return true;

};

// IF next character is [, and ! delimiter to delimiter stack and
// add a Str to inlines.  Otherwise just add a Str.
var parseBang = function(inlines) {

    var startpos = this.pos;
    this.pos += 1;
    if (this.peek() === C_OPEN_BRACKET) {
        this.pos += 1;
        inlines.push(Str("!["));

        // Add entry to stack for this opener
        this.delimiters = { cc: C_BANG,
                            numdelims: 1,
                            pos: inlines.length - 1,
                            previous: this.delimiters,
                            next: null,
                            can_open: true,
                            can_close: false,
                            index: startpos + 1 };
        if (this.delimiters.previous !== null) {
            this.delimiters.previous.next = this.delimiters;
        }
    } else {
        inlines.push(Str("!"));
    }
    return true;
};

// Try to match close bracket against an opening in the delimiter
// stack.  Add either a link or image, or a plain [ character,
// to the inlines stack.  If there is a matching delimiter,
// remove it from the delimiter stack.
var parseCloseBracket = function(inlines) {
    var startpos;
    var is_image;
    var dest;
    var title;
    var matched = false;
    var link_text;
    var i;
    var opener, closer_above, tempstack;

    this.pos += 1;
    startpos = this.pos;

    // look through stack of delimiters for a [ or !
    opener = this.delimiters;
    while (opener !== null) {
        if (opener.cc === C_OPEN_BRACKET || opener.cc === C_BANG) {
            break;
        }
        opener = opener.previous;
    }

    if (opener === null) {
        // no matched opener, just return a literal
        inlines.push(Str("]"));
        return true;
    }

    // If we got here, open is a potential opener
    is_image = opener.cc === C_BANG;
    // instead of copying a slice, we null out the
    // parts of inlines that don't correspond to link_text;
    // later, we'll collapse them.  This is awkward, and could
    // be simplified if we made inlines a linked list rather than
    // an array:
    link_text = inlines.slice(0);
    for (i = 0; i < opener.pos + 1; i++) {
        link_text[i] = null;
    }

    // Check to see if we have a link/image

    // Inline link?
    if (this.peek() === C_OPEN_PAREN) {
        this.pos++;
        if (this.spnl() &&
            ((dest = this.parseLinkDestination()) !== null) &&
            this.spnl() &&
            // make sure there's a space before the title:
            (/^\s/.test(this.subject.charAt(this.pos - 1)) &&
             (title = this.parseLinkTitle() || '') || true) &&
            this.spnl() &&
            this.match(/^\)/)) {
            matched = true;
        }
    } else {

        // Next, see if there's a link label
        var savepos = this.pos;
        this.spnl();
        var beforelabel = this.pos;
        n = this.parseLinkLabel();
        if (n === 0 || n === 2) {
            // empty or missing second label
            reflabel = this.subject.slice(opener.index, startpos);
        } else {
            reflabel = this.subject.slice(beforelabel, beforelabel + n);
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
        this.processEmphasis(link_text, opener.previous);

        // remove the part of inlines that became link_text.
        // see note above on why we need to do this instead of splice:
        for (i = opener.pos; i < inlines.length; i++) {
            inlines[i] = null;
        }

        // processEmphasis will remove this and later delimiters.
        // Now, for a link, we also remove earlier link openers.
        // (no links in links)
        if (!is_image) {
          opener = this.delimiters;
          closer_above = null;
          while (opener !== null) {
            if (opener.cc === C_OPEN_BRACKET) {
              if (closer_above) {
                closer_above.previous = opener.previous;
              } else {
                this.delimiters = opener.previous;
              }
            } else {
              closer_above = opener;
            }
            opener = opener.previous;
          }
        }

        inlines.push({t: is_image ? 'Image' : 'Link',
                      destination: dest,
                      title: title,
                      label: link_text});
        return true;

    } else { // no match

        this.removeDelimiter(opener);  // remove this opener from stack
        this.pos = startpos;
        inlines.push(Str("]"));
        return true;
    }

};

// Attempt to parse an entity, return Entity object if successful.
var parseEntity = function(inlines) {
    var m;
    if ((m = this.match(reEntityHere))) {
        inlines.push({ t: 'Str', c: entityToChar(m) });
        return true;
    } else {
        return false;
    }
};

// Parse a run of ordinary characters, or a single character with
// a special meaning in markdown, as a plain string, adding to inlines.
var parseString = function(inlines) {
    var m;
    if ((m = this.match(reMain))) {
        inlines.push({ t: 'Str', c: m });
        return true;
    } else {
        return false;
    }
};

// Parse a newline.  If it was preceded by two spaces, return a hard
// line break; otherwise a soft line break.
var parseNewline = function(inlines) {
    var m = this.match(/^ *\n/);
    if (m) {
        if (m.length > 2) {
            inlines.push({ t: 'Hardbreak' });
        } else if (m.length > 0) {
            inlines.push({ t: 'Softbreak' });
        }
        return true;
    }
    return false;
};

// Attempt to parse an image.  If the opening '!' is not followed
// by a link, return a literal '!'.
var parseImage = function(inlines) {
    if (this.match(/^!/)) {
        var link = this.parseLink(inlines);
        if (link) {
            inlines[inlines.length - 1].t = 'Image';
            return true;
        } else {
            inlines.push({ t: 'Str', c: '!' });
            return true;
        }
    } else {
        return false;
    }
};

// Attempt to parse a link reference, modifying refmap.
var parseReference = function(s, refmap) {
    this.subject = s;
    this.pos = 0;
    this.label_nest_level = 0;
    var rawlabel;
    var dest;
    var title;
    var matchChars;
    var startpos = this.pos;
    var match;

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
// On success, add the result to the inlines list, and return true.
// On failure, return false.
var parseInline = function(inlines) {
    var startpos = this.pos;
    var origlen = inlines.length;

    var c = this.peek();
    if (c === -1) {
        return false;
    }
    var res;
    switch(c) {
    case C_NEWLINE:
    case C_SPACE:
        res = this.parseNewline(inlines);
        break;
    case C_BACKSLASH:
        res = this.parseBackslash(inlines);
        break;
    case C_BACKTICK:
        res = this.parseBackticks(inlines);
        break;
    case C_ASTERISK:
    case C_UNDERSCORE:
        res = this.parseEmphasis(c, inlines);
        break;
    case C_OPEN_BRACKET:
        res = this.parseOpenBracket(inlines);
        break;
    case C_BANG:
        res = this.parseBang(inlines);
        break;
    case C_CLOSE_BRACKET:
        res = this.parseCloseBracket(inlines);
        break;
    case C_LESSTHAN:
        res = this.parseAutolink(inlines) || this.parseHtmlTag(inlines);
        break;
    case C_AMPERSAND:
        res = this.parseEntity(inlines);
        break;
    default:
        res = this.parseString(inlines);
        break;
    }
    if (!res) {
        this.pos += 1;
        inlines.push({t: 'Str', c: fromCodePoint(c)});
    }

    return true;
};

// Parse s as a list of inlines, using refmap to resolve references.
var parseInlines = function(s, refmap) {
    this.subject = s;
    this.pos = 0;
    this.refmap = refmap || {};
    this.delimiters = null;
    var inlines = [];
    while (this.parseInline(inlines)) {
    }
    this.processEmphasis(inlines, null);
    return inlines;
};

// The InlineParser object.
function InlineParser(){
    return {
        subject: '',
        label_nest_level: 0, // used by parseLinkLabel method
        delimiters: null,  // used by parseEmphasis method
        pos: 0,
        refmap: {},
        match: match,
        peek: peek,
        spnl: spnl,
        unescapeString: unescapeString,
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

},{"./from-code-point.js":2,"./html5-entities.js":4}],7:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],8:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canMutationObserver = typeof window !== 'undefined'
    && window.MutationObserver;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    var queue = [];

    if (canMutationObserver) {
        var hiddenDiv = document.createElement("div");
        var observer = new MutationObserver(function () {
            var queueList = queue.slice();
            queue.length = 0;
            queueList.forEach(function (fn) {
                fn();
            });
        });

        observer.observe(hiddenDiv, { attributes: true });

        return function nextTick(fn) {
            if (!queue.length) {
                hiddenDiv.setAttribute('yes', 'no');
            }
            queue.push(fn);
        };
    }

    if (canPost) {
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],9:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],10:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":9,"_process":8,"inherits":7}]},{},[5])(5)
});