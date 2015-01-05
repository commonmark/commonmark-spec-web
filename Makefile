SPECVERSION=$(shell grep version: ../spec.txt | sed -e 's/version: *//')
MAINREPO=..

update: dingus.html js/commonmark.js $(SPECVERSION)/index.html js/LICENSE changelog.spec.txt index.html

upload:
	git pull; git push; git push --tags

index.html: $(MAINREPO)/spec.txt
	./make_site_index.sh $(SPECVERSION) | \
	  pandoc --template template.html -S -s -t html5 -o $@ ; \
	git add spec.html $(SPECVERSION)/index.html $(SPECVERSION)/changes.html $(SPECVERSION)/spec.txt ; \
	git commit -a -m "Updated to version $(SPECVERSION) of spec"; \
	git tag $(SPECVERSION) HEAD

$(SPECVERSION)/index.html: $(MAINREPO)/spec.txt $(MAINREPO)/spec.html $(MAINREPO)/changelog.spec.txt
	git tag --list | grep -q -v $(SPECVERSION) ; \
	mkdir -p $(SPECVERSION) ; \
	cp $(MAINREPO)/spec.html $@ ; \
	cp $(MAINREPO)/spec.txt $(SPECVERSION)/spec.txt; \
	cp $(SPECVERSION)/index.html spec.html

js/commonmark.js: $(MAINREPO)/js/commonmark.js
	cp $< $@

%: $(MAINREPO)/%
	cp $< $@
