#!/bin/sh

SPECVERSION=$1
VERSIONS=`ls -d -1 0.* | sort -r -g`

echo "% CommonMark Spec"
echo ""
date=`grep '<div class="version">' $SPECVERSION/index.html | perl  -pe 's/^.*(\d\d\d\d-\d\d-\d\d).*$/\1/'`
echo "[**Latest version ($SPECVERSION)**]($SPECVERSION/) ($date) ([view changes]($SPECVERSION/changes.html 'See changes from previous version') | [test cases]($SPECVERSION/spec.json))"
echo ""
echo "[discussion forum](http://talk.commonmark.org/) | "
echo "[interactive dingus](dingus/) | "
echo "[repository](https://github.com/jgm/CommonMark/) | "
echo "[changelog](changelog.txt)"
echo ""
echo "Older versions:"
echo ""
for vers in $VERSIONS
  do
    date=`grep '<div class="version">' $vers/index.html | perl  -pe 's/^.*(\d\d\d\d-\d\d-\d\d).*$/\1/'`
    if [ "$vers" != "$SPECVERSION" ]; then
	perl -p -i -e 's/<div id="watermark">.*?<\/div>/<div id="watermark" style="background-color:black">This is an older version of the spec. For the most recent version, see <a href="http:\/\/spec.commonmark.org">http:\/\/spec.commonmark.org<\/a>.<\/div>/' $vers/index.html
        changes=""
        [ -f $vers/changes.html ] && changes=" ([view changes]($vers/changes.html 'See changes from previous version'))"
        echo "- [$vers]($vers/) ($date)$changes"
    fi
  done | sort -r -k3 | tee PREVIOUS
PREV_VERSION=`head -1 PREVIOUS | perl -pe 's/- \[([^]]*).*/\1/'`
rfcdiff --html --width 80 --stdout $PREV_VERSION/spec.txt $SPECVERSION/spec.txt | perl -pe 's/charset=iso-8859-1/charset=utf-8/' > $SPECVERSION/changes.html
