on cleanText(theValue)
	if theValue is missing value then return ""
	return theValue as text
end cleanText

set controlRoles to {"AXButton", "AXCheckBox", "AXComboBox", "AXLink", "AXPopUpButton", "AXRadioButton", "AXSearchField", "AXTextField"}

tell application "System Events"
	tell process "Creative Cloud"
		set allElements to entire contents of window "Creative Cloud Desktop"
		repeat with theElement in allElements
			set roleName to ""
			try
				set roleName to my cleanText(role of theElement)
			end try
			if controlRoles contains roleName then
				set elementName to ""
				set elementDescription to ""
				set elementValue to ""
				set elementPosition to ""
				try
					set elementName to my cleanText(name of theElement)
				end try
				try
					set elementDescription to my cleanText(description of theElement)
				end try
				try
					set elementValue to my cleanText(value of theElement)
				end try
				try
					set elementPosition to my cleanText(position of theElement)
				end try
				log roleName & "|" & elementName & "|" & elementDescription & "|" & elementValue & "|" & elementPosition
			end if
		end repeat
	end tell
end tell
