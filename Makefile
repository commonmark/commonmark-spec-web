SPECVERSION=$(shell grep version: ../spec.txt | sed -e 's/version: *//')

update: dingus.html js/commonmark.js $(SPECVERSION)/index.html index.html js/LICENSE

upload:
	git pull; git commit -a -m "Updated site for latest spec, js" ; git push ; git push --tags

index.html:
	./make_site_index.sh $(SPECVERSION) | \
	  pandoc --template ../template.html -S -s -t html5 -o $@

$(SPECVERSION)/index.html:
	mkdir -p $(SPECVERSION) ; \
	cp ../spec.html $@ ; \
	cp ../spec.txt $(SPECVERSION)/spec.txt; \
	git add $(SPECVERSION)/index.html $(SPECVERSION)/spec.txt; git commit -a -m "Added version $(SPECVERSION) of spec"; \
	git tag $(SPECVERSION) HEAD

%: ../%
	cp $< $@
