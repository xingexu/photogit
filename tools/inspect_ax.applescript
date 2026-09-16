on cleanText(theValue)
	if theValue is missing value then return ""
	return theValue as text
end cleanText

on walkElement(theElement, theDepth)
	tell application "System Events"
		set roleName to ""
		set elementName to ""
		set elementDescription to ""
		try
			set roleName to my cleanText(role of theElement)
		end try
		try
			set elementName to my cleanText(name of theElement)
		end try
		try
			set elementDescription to my cleanText(description of theElement)
		end try

		if elementName is not "" or elementDescription is not "" then
			log (theDepth as text) & "|" & roleName & "|" & elementName & "|" & elementDescription
		end if

		set childElements to {}
		try
			set childElements to UI elements of theElement
		end try
	end tell

	repeat with childElement in childElements
		my walkElement(childElement, theDepth + 1)
	end repeat
end walkElement

tell application "System Events"
	tell process "Creative Cloud"
		my walkElement(window "Creative Cloud Desktop", 0)
	end tell
end tell
