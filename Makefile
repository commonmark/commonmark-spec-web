SPECVERSION=$(shell grep version: ../spec.txt | sed -e 's/version: *//')
MAINREPO=..

update: dingus.html js/commonmark.js $(SPECVERSION)/index.html index.html js/LICENSE

upload:
	git pull; git commit -a -m "Updated site for latest spec, js" ; git push ; git push --tags

index.html: $(MAINREPO)/spec.txt
	./make_site_index.sh $(SPECVERSION) | \
	  pandoc --template $(MAINREPO)/template.html -S -s -t html5 -o $@

$(SPECVERSION)/index.html: $(MAINREPO)/spec.txt $(MAINREPO)/spec.html $(MAINREPO)/changelog.spec.txt
	git tag --list | grep -v $(SPECVERSION) >/dev/null ; \
	mkdir -p $(SPECVERSION) ; \
	cp $(MAINREPO)/spec.html $@ ; \
	cp $(MAINREPO)/spec.txt $(SPECVERSION)/spec.txt; \
	rm spec.html; \
	cp $(SPECVERSION)/index.html spec.html; \
	git add spec.html $(SPECVERSION)/index.html $(SPECVERSION)/changes.html $(SPECVERSION)/spec.txt; git commit -a -m "Added version $(SPECVERSION) of spec"; \
	git tag $(SPECVERSION) HEAD

js/commonmark.js: $(MAINREPO)/js/commonmark.js
	cp $< $@

%: $(MAINREPO)/%
	cp $< $@
